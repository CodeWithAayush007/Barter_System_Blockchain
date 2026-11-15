# Trove Backend — Express + Cloudinary + MongoDB API

The **off-chain helper** for the Trove barter dApp. The blockchain is the
source of truth for everything that matters in a trade — who owns a listing,
what state a trade is in, who has locked what, who was paid. This API only
stores what a blockchain is bad at, and it **cannot declare that a trade has
started, completed or been cancelled**:

| This backend stores… | …and how it stays honest |
|---|---|
| Listing **photos** and trade-**request photos** (files, stored on **Cloudinary**, not on this server) | A photo is only uploaded if the wallet is the listing's on-chain owner (or the request's on-chain requester) **and** the SHA-256 of the received bytes equals the `imageHash` committed on-chain (see `controllers/imageController.js`). Nothing about the listing is stored here at all. |
| Wallet **sign-in** sessions + profiles | Wallet-signature auth (below). |
| A readable **activity feed** | Rows are created only from events in a *mined transaction* read from the chain (`POST /api/activity/sync`), restricted to logs from the real BarterAgreement address, and idempotent. Messages never contain star counts or bonus amounts (rating privacy). |

MongoDB now holds only two collections: **`users`** and **`activities`**. The former `listings` and
`requestphotos` collections were removed — they only duplicated what the blockchain already stores plus a file path,
and the file path is now replaced by a Cloudinary URL that the frontend derives from the on-chain hash.

Removed on purpose: the old `/api/trades` routes (a database record that said
"completed" independently of the chain), the listing `PUT`/`DELETE`/status
routes (those are contract calls: `deactivateListing`), and the `/api/listings` + `/api/requests` metadata routes
(replaced by `POST /api/images/listings` and `POST /api/images/requests`, below).

## Stack

- **Express** — HTTP API
- **MongoDB / Mongoose** — data storage
- **ethers v6** — read-only access to the chain, used to verify claims
- **JWT + wallet-signature auth** (SIWE-style, no passwords)
- **Cloudinary** (official `cloudinary` Node SDK) — stores and delivers the photos
- **Multer** — receives an upload into memory (nothing is written to this server's disk)
- **helmet, express-rate-limit, express-mongo-sanitize, express-validator** —
  security/hardening

## Setup

```bash
cp .env.example .env      # then edit MONGODB_URI, JWT_SECRET and the three CLOUDINARY_* values
npm install
npm run dev                # nodemon, http://localhost:5000
npm test                   # unit tests (no chain, database or Cloudinary account needed)
npm run e2e:images         # optional: full photo workflow against your running local chain (see below)
```

`.env` is created from `.env.example` automatically when you start the whole project from the top folder
(`npm run dev` there); otherwise copy it yourself. **MongoDB is optional to start**: without it the API
still comes up and answers `503 database not connected` for sign-in and the activity feed (it keeps
retrying in the background), while trading itself — which is on the blockchain — is unaffected.
**Cloudinary is optional to start too**: without the `CLOUDINARY_*` values the API runs and photo uploads answer
`503 Image storage is not configured`.

Requires a running MongoDB instance — either local (`mongodb://127.0.0.1:27017`)
or a connection string from MongoDB Atlas — **and** the local Hardhat node with
the contracts deployed (see the Blockchain README). `npm run deploy:local`
writes `src/chain/abi.json` and `src/chain/deployed.json`, which is how this
API finds the contract; set `CHAIN_RPC_URL` only if your node isn't at
`http://127.0.0.1:8545`. If the node is down the chain-verified routes answer
`503` with a clear message; everything else keeps working.

## Auth flow (wallet signature, not passwords)

1. `GET /api/auth/nonce/:address` → returns a message containing a fresh nonce.
2. Frontend calls `signer.signMessage(message)` in MetaMask.
3. `POST /api/auth/verify { address, signature }` → server recovers the
   signing address with `ethers.verifyMessage` and, if it matches, returns a
   JWT. Nonce is invalidated immediately so it can't be replayed.
4. Frontend sends `Authorization: Bearer <token>` on subsequent write requests.

This means no separate password/registration flow — owning the wallet **is**
the login.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/auth/nonce/:address` | – | Get a message to sign |
| POST | `/api/auth/verify` | – | Exchange signature for JWT |
| POST | `/api/images/listings` | ✅ owner | Upload the photo of an **existing on-chain listing** (multipart: `onChainListingId`, `image`) → Cloudinary. The wallet must be the listing's on-chain owner and the file's SHA-256 must equal the listing's on-chain `imageHash`. Answers `{ imageHash, publicId, secureUrl, existing }` — `201` when stored, `200` when that exact image was already there. |
| POST | `/api/images/requests` | ✅ requester | Same for the photo of what a requester offers (multipart: `onChainRequestId`, `image`); the wallet must be the request's on-chain requester and the hash must equal the request's on-chain `imageHash`. |
| POST | `/api/activity/sync` | – | `{ txHash }` — record the BarterAgreement events of a mined tx as activity rows |
| GET | `/api/activity/:address` | – | Activity feed |
| PATCH | `/api/activity/:id/read` | ✅ | Mark one notification read |
| GET | `/api/users/:address` | – | Public profile |
| PUT | `/api/users/me` | ✅ | Update own profile (multipart, field `avatar` → stored on Cloudinary) |

## Security notes

- All string inputs are length/format validated with `express-validator`
  before hitting a controller (see `src/routes/*.js`).
- `express-mongo-sanitize` strips `$`/`.` keys from `req.body`/`query`/`params`
  to block NoSQL injection.
- Photo uploads sit behind a tighter rate limiter than reads, and activity sync
  has its own limiter (it makes the backend read the chain).
- Nothing the client sends is trusted: the client sends only an id and the file. The owner/requester and the
  expected hash are read from the contract, and the JWT's address must equal the on-chain owner/requester.
- **Integrity:** the SHA-256 of the *received bytes* is compared with the on-chain `imageHash` before anything
  is sent to Cloudinary. Naming an image after its hash is only a naming scheme — the check is what makes it true.
- The on-chain `imageHash` is free text (the contract only caps its length), so it is validated as a 64-hex SHA-256
  before it is ever used in a Cloudinary name; anything else (e.g. `../../x`) is refused.
- **Type and size:** the file's real signature (magic bytes) must be PNG, JPEG, GIF or WEBP — the file name and
  Content-Type are not believed — and it must be under `MAX_UPLOAD_MB` (default 5 MB). SVG and other formats are refused.
- **No overwrites, no deletion:** uploads use `overwrite: false` and a name derived only from the verified hash, so an
  existing image can never be replaced; there is no delete or replace endpoint. (Because the name is a content hash,
  two listings that use the same file share one stored image — deleting it for one would break the other.)
- **No remote URLs:** only an uploaded file is accepted; the server never fetches a URL on a client's behalf.
- Uploads are held in memory (never on disk); a rejected request leaves nothing behind.
- Photo uploads sit behind a tighter rate limiter than reads, and activity sync has its own limiter (it makes
  the backend read the chain).
- The Cloudinary **API secret exists only in this folder's `.env`**. It is never sent to the browser; the website
  only needs the public cloud name.
- Cloudinary failures (bad credentials, rate limit, timeout, outage) become short `502/503/504` messages;
  details go to the server log only.

## Cloudinary setup

1. Create a free account at <https://cloudinary.com/users/register_free> (a verification email is sent).
2. Open the **Cloudinary Console** → **Settings** (gear icon) → **API Keys** (older consoles: the *Dashboard* shows
   "Product Environment Credentials"). Copy the **Cloud name**, **API Key** and **API Secret**.
3. Put them in `backend_test/.env` (this file is not committed and the secret must stay here):

   ```
   CLOUDINARY_CLOUD_NAME=your-cloud-name
   CLOUDINARY_API_KEY=123456789012345
   CLOUDINARY_API_SECRET=your-api-secret
   # CLOUDINARY_FOLDER=trove        # optional, default "trove"
   ```
4. Put **only the cloud name** in `Frontend/.env` as `VITE_CLOUDINARY_CLOUD_NAME` (it is public — it is part of every
   image URL), then restart `npm run dev` for both folders. Never put the API key/secret in the frontend.

Images are stored as `<folder>/<sha256-hex>` and delivered from
`https://res.cloudinary.com/<cloud name>/image/upload/<transformations>/<folder>/<sha256-hex>`.
**Leave Cloudinary's default "Strict transformations" setting off** (Settings → Security) — the website asks for
`f_auto,q_auto` on delivery. If you turn it on, set `VITE_CLOUDINARY_TRANSFORM=` (empty) in `Frontend/.env`.

## Checking the photo workflow

`npm test` runs unit tests that need nothing external. `npm run e2e:images` is an optional end-to-end check of the
whole photo flow against your **running local chain** (start it and deploy first, see the Blockchain README). It runs the real
`src/app.js` and the real contracts — it creates a few listings and requests on that chain, so use a throw-away dev
chain — but replaces Cloudinary with an in-memory fake, so it needs no account and uploads nothing anywhere.

## Cleaning up the old MongoDB collections (one-time, manual)

The app no longer reads or writes the `listings` and `requestphotos` collections, **but it does not delete them** —
that is left to you. They hold only copies of on-chain data plus paths of files that lived in the old `uploads/`
folder. Before dropping anything:

1. Decide whether you need the old photos. They are **not migrated automatically**: the files were on the disk of the
   machine that ran the old backend, and on a local Hardhat chain the old listing/request ids are meaningless after a
   restart anyway. If you do have a persistent chain with photos you want to keep, back up `uploads/` first and ask for a
   one-off migration (hash each file, compare with the chain, upload under `<folder>/<hash>`).
2. Optionally back up: `mongodump --uri "<MONGODB_URI>" --collection listings` (and `requestphotos`).
3. Drop them (the `users` and `activities` collections are untouched):

   ```
   mongosh "<MONGODB_URI>" --eval 'db.listings.drop(); db.requestphotos.drop()'
   ```
4. The old `backend_test/uploads/` folder is no longer used or created; delete your local copy once you have what you need.

## Troubleshooting: `querySrv ECONNREFUSED` on Windows

If `npm run dev` connects to `.env` fine but crashes with something like:

```
querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net
```

this is **not** a code, Atlas, or Node-version problem — it's a known
Node-on-Windows issue. `mongodb+srv://` URIs require Node to resolve a DNS
SRV record itself, using its bundled `c-ares` resolver, which talks directly
to whatever DNS server your network adapter is configured with. Some routers/
networks don't proxy SRV queries correctly and refuse them, while `nslookup`,
PowerShell's `Resolve-DnsName`, and .NET's DNS calls all go through the
separate Windows DNS Client service and succeed — so seeing those tools work
while Node fails is the expected signature of this bug, not a contradiction.

`src/config/db.js` already points Node's resolver at Google/Cloudflare DNS
(`dns.setServers(...)`) before connecting, which fixes it in most cases. If it
still fails:

1. Try a different resolver via `.env`: `DNS_SERVERS=1.1.1.1,8.8.8.8`
2. Or sidestep SRV lookups entirely — in Atlas, **Database → Connect →
   Drivers**, switch the connection-string dropdown from `mongodb+srv://` to
   the standard `mongodb://` string (it lists each shard host directly and
   needs no SRV/TXT DNS lookup at all), and use that as `MONGODB_URI`.

## Connecting the frontend

The barter-frontend project expects (or can easily be pointed at) this API's
base URL via an env var, e.g. `VITE_API_URL=http://localhost:5000/api`. See
`src/utils/api.js` in the frontend for the fetch wrapper that attaches the
JWT and handles error responses from this API.
