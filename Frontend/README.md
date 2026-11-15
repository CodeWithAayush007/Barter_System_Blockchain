# Trove — Decentralized Barter Marketplace (Frontend)

React + Vite + Tailwind frontend for the barter dApp. **The blockchain is the
source of truth**: listings, trade requests, trade status, escrowed funds, BTK
balances and reputation are all read straight from the four contracts
(`BarterToken`, `Escrow`, `BarterAgreement`, `Reputation`), and every action
(create a listing, request, accept, confirm, dispute, rate, settle…) is a real
wallet transaction. The Express + MongoDB API (`../backend_test`) only uploads
photos to Cloudinary, handles sign-in sessions and a cached activity feed — it cannot change a trade.

Read `../BARTER_RULES.md` for the trade rules (BTK stake **X**, ETH amount **Y**, who locks what for barter / sell / buy,
5 %-per-star rewards, dispute rulings, cancelling in escrow) and a table of what is stored on-chain vs off-chain.
The same rules, with a live calculator, are on the **/rules** page of the app.

## Three listing types

| Type | Meaning |
|---|---|
| **Barter** | Swap an item for another item — both sides lock X BTK **and** Y ETH (a deposit returned when both confirm) |
| **Sell** | Fixed ETH price Y — the seller locks X, the buyer locks X + Y; a photo is required |
| **Buy** | You want an item and offer Y ETH — you (buyer) lock X + Y, the requester (seller) locks X |

## Run it (local prototype)

**Easiest:** from the project's top folder run `npm run dev` — it starts the blockchain, the backend and
this website together (see the top-level `README.md`, which also has the MetaMask setup and troubleshooting).

To run this website on its own (the chain and backend started separately, in this order):

```bash
# 1 — chain + contracts            (in ../Blockchain; leave it running)
npm install && npm run dev
# 2 — backend (photo uploads + sign-in)   (in ../backend_test; optional for trading)
npm install && npm run dev
# 3 — this app                     (in this folder)
npm install
npm run dev                         # http://localhost:5173
```

`npm run dev` in `../Blockchain` writes the contract addresses + ABIs into `src/blockchain/` and
`../backend_test/src/chain/` for you. `npm run dev:demo` there also adds a few demo listings.

Then in MetaMask: add the network **Hardhat Localhost** (RPC `http://127.0.0.1:8545`, chain id `31337`),
import one or two of the test private keys the chain prints (account #0 is the **admin** — the only wallet
that sees the Admin page; it cannot trade and has no reputation), and claim your **100 BTK** (once per wallet) on the **Tokens** page.

Without a wallet the marketplace is still readable (listings come from the chain over the read-only RPC);
every action asks you to connect first.

> Restarting the chain wipes it (all listings, trades and balances). Run `npm run dev` in `../Blockchain`
> again and refresh the page. If MetaMask complains about a nonce after a restart, use
> *Settings → Advanced → Clear activity tab data*.

## Project structure

```
src/
├── blockchain/
│   ├── barterService.js   THE ONLY place that talks to the contracts: all reads
│   │                      (listings, trades, reputation, balances, history) and all
│   │                      writes (create/request/accept/confirm/dispute/rate/…),
│   │                      incl. BTK approval + exact ETH amounts + decoded outcomes
│   ├── contract.js        ethers Contract factory (per chain)
│   ├── networks.js        supported chains; addresses come from deployed.json
│   ├── provider.js        wallet provider, read-only RPC provider, network switching
│   ├── deployed.json      ← written by `npm run deploy:local`
│   └── abi/*.json         ← written by `npm run deploy:local`
├── hooks/                 useWallet, useAuth (wallet-signature login), useBarter
│                          (shared service + refresh tick), useListings, useTrades,
│                          useReputation, useTokenBalance, useTokenHistory, useAdmin,
│                          useRules, useActivity, useChainAction (tx wrapper), …
├── pages/                 Landing, Dashboard, Marketplace, CreateListing,
│                          TradeManagement, Reputation, TokenDashboard, Admin, Rules
├── components/            Navbar, Sidebar, ListingCard, TradeCard, StarRating,
│                          TokenBalanceCard, NetworkWarning, StarterTokensBanner, …
└── utils/                 api.js (backend fetch wrapper), errors.js (revert reasons →
                           plain English), validation.js, format.js, listingMeta.js /
                           requestMeta.js (photo hashing, upload, URL lookup),
                           cloudinary.js (hash → Cloudinary URL), trades.js
```

## Reads vs writes

Every **read** (listings, trades, balances, reputation) goes straight to the chain's own RPC node
(`http://127.0.0.1:8545` locally), never through MetaMask — MetaMask caches a stale view of a local chain
after it restarts. The wallet is used only to **sign and send** transactions, and before each one the app
checks the wallet can see the same contracts (otherwise it tells you the wallet is on a different chain).
If the contracts can't be found, the *Can't read the blockchain* screen shows exactly what was checked.

## How a write works

`useChainAction().perform(fn)` runs a service call (e.g. `service.requestTrade(...)`),
shows the wallet prompt(s), waits for the transaction to be **mined**, shows a toast with
the plain-English result (contract revert reasons are decoded), refreshes the chain data,
and asks the backend to record the transaction's events in the activity feed. Buttons are
disabled while a transaction is in flight.

Data hooks re-read the chain after every transaction and every 8 seconds while the tab is
visible, so the other trader sees "your counterparty just locked their stake" without
reloading.

## Photos

Photos are stored on **Cloudinary**. The blockchain keeps only each photo's SHA-256 fingerprint (`imageHash`), and
the website derives the image URL from it — there is no id → URL lookup and nothing is cached by listing id:

```
https://res.cloudinary.com/<VITE_CLOUDINARY_CLOUD_NAME>/image/upload/f_auto,q_auto/<folder>/<imageHash without 0x>
```

Because the name is the hash of the *file*, not a listing or trade number, a restarted local chain can never attach an
old photo to a new listing that happens to reuse the same id. (`utils/cloudinary.js` validates that the on-chain value
really is a SHA-256 before using it, so a hostile string can't change the URL.)

- **Listing photo** (required for *Sell*, optional otherwise): the app computes its SHA-256 from the original file bytes,
  stores that fingerprint **in the on-chain listing**, then uploads the file to the backend (`POST /api/images/listings`),
  which checks that you own the listing and that the file matches the hash before sending it to Cloudinary.
- **Request photo** (optional on *Barter* and *Buy* requests): the requester shows what they offer and its
  condition. Same mechanism (`POST /api/images/requests`): the fingerprint goes on-chain with the request, the file goes
  to the backend after the transaction is mined, and the owner sees it on the request card. If the upload fails the
  request still exists — the requester gets an **"Upload again"** button on the trade card (the file must match the on-chain hash).
- If a photo's hash is on-chain but the file isn't on Cloudinary (yet), cards show the placeholder / "Photo unavailable"
  instead of a broken image, and quietly retry a few times.

## Who sees what

- **Ratings you receive are never shown to you** — only the stars you gave, and whether the other side has rated.
  Others see your average. This is an app-level rule (`decorateTrade` strips the stars; `useReputation` zeroes your
  own average) — the blockchain itself is public.
- **The admin** gets only the Admin page (open rulings, returns waiting, **dispute history**), Marketplace and
  Rules. Trading pages show "The admin does not trade"; the admin's Reputation page says it has none.

## Notes

- Wallet session (address, chain, connect/disconnect) lives in `hooks/useWallet.jsx`; the
  backend session (JWT) lives in `hooks/useAuth.jsx` and is cleared automatically when you
  switch MetaMask accounts. Only photo upload needs a backend sign-in; trading does not.
- Settings (see `.env.example`): `VITE_API_URL` and `VITE_CLOUDINARY_CLOUD_NAME` (the public cloud name — never the API key or secret);
  optionally `VITE_CLOUDINARY_FOLDER` and `VITE_CLOUDINARY_TRANSFORM`.
- `npm run build` → production build in `dist/` (it warns about a >500 kB chunk; code-splitting
  is a listed improvement, not a bug).
