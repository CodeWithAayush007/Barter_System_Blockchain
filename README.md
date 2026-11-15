# Trove — Decentralized Barter Marketplace (local prototype)

Barter, sell or buy items with a BTK stake (and ETH) locked in escrow on both sides, enforced by smart contracts.
Rules (barter, sell, buy — who locks what, disputes, cancel): [`BARTER_RULES.md`](BARTER_RULES.md).  Folders: `Blockchain/` (contracts), `backend_test/`
(API for photo uploads + sign-in), `Frontend/` (website). Photos are stored on [Cloudinary](https://cloudinary.com).

## Quick start — one command

Needs **Node.js 18 or newer** (check with `node -v`; get the LTS from https://nodejs.org) and the
**MetaMask** browser extension. Open a terminal **in this folder** (the one containing this README):

```bash
npm run dev
```

That's it. On the first run it installs the three folders' dependencies, then starts, in order:

| Tag in the output | What | Address |
|---|---|---|
| `[chain]` | local blockchain, with the 4 contracts compiled + deployed | http://127.0.0.1:8545 |
| `[api]`   | backend API (photo uploads, sign-in, activity feed) | http://localhost:5000 |
| `[web]`   | the website | **http://localhost:5173** |

When you see `ALL RUNNING`, open **http://localhost:5173**. Press **Ctrl+C** once to stop everything.
`npm run dev:demo` does the same and also creates a few demo listings so the marketplace isn't empty.
(The very first run compiles the contracts and downloads the Solidity compiler — give it a minute and
keep an internet connection on.)

> `npm run setup` only installs the dependencies (without starting anything).

### Prefer separate terminals?

Each folder has its own `npm run dev`, so this works too (start them in this order):

```bash
cd Blockchain   && npm install && npm run dev      # chain + deploy      (keep open)
cd backend_test && npm install && npm run dev      # API on :5000
cd Frontend     && npm install && npm run dev      # website on :5173
```

## One-time MetaMask setup

The `[chain]` output ends with a box containing everything below.

1. **Add the network** — MetaMask → network picker → *Add network manually*:
   name `Hardhat Localhost`, RPC URL `http://127.0.0.1:8545`, chain ID `31337`, symbol `ETH`.
2. **Import test accounts** — MetaMask → account menu → *Import account* → paste a private key from the box.
   Account **#0 is the admin** (the only wallet that sees the *Admin* page, rules on disputes and keeps the dispute
   history — it **cannot list or trade** and has no reputation); use #1, #2, #3 as traders. These are the public Hardhat test keys — never use them on a real network.
3. In the website click **Connect Wallet**, open **Tokens** and **claim your 100 BTK** (once per wallet).
   To try a whole trade you need two traders: switch accounts in MetaMask between steps.

## The database (MongoDB) is optional for trading

Everything that matters in a trade lives on the blockchain and works without MongoDB. MongoDB is only used
for **sign-in and the activity feed** (collections `users` and `activities`). Without it the API still starts and says
"database not connected" for those features. To enable them, edit `backend_test/.env`
(created automatically on first run): keep the local default if you run MongoDB on your machine, or paste
your MongoDB Atlas connection string into `MONGODB_URI`.

## Photos (Cloudinary) — set up once

Listing photos, trade-request photos and avatars are stored on **Cloudinary**, not on your computer. The blockchain keeps each
photo's SHA-256 fingerprint; the backend uploads a file only if it matches that fingerprint and the wallet owns the
listing/request; the website builds the image URL from the fingerprint. Trading works without any of this — only photos need it.

1. Create a free account: <https://cloudinary.com/users/register_free>.
2. In the Cloudinary Console open **Settings → API Keys** and copy your **Cloud name**, **API Key**, **API Secret**.
3. `backend_test/.env` (secret stays here):

   ```
   CLOUDINARY_CLOUD_NAME=your-cloud-name
   CLOUDINARY_API_KEY=123456789012345
   CLOUDINARY_API_SECRET=your-api-secret
   ```
4. `Frontend/.env` (**cloud name only** — it is public):

   ```
   VITE_CLOUDINARY_CLOUD_NAME=your-cloud-name
   ```
5. Restart `npm run dev`. (`npm run dev` creates both `.env` files from their `.env.example` if they are missing and tells you which
   Cloudinary values are still empty.)

More detail, security notes and the cleanup of the old `listings` / `requestphotos` collections: [`backend_test/README.md`](backend_test/README.md).

## Showing proof that the blockchain is changing

The chain window prints every mined transaction with its **hash and block number**. For a closer look, open a second terminal in `Blockchain/`:

```bash
npm run proof                 # latest block + hash, ETH/BTK held in escrow, BTK supply, listing/request counters, last 15 transactions
npm run proof -- 0xTXHASH     # one transaction: block, sender, function, and every event it emitted
```

Run it before and after an action (create a listing, request, accept, rate): the block number, hashes, escrow balances and counters change. Nothing is read from the database — it all comes from the node.

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm error Missing script: "dev"` | You're in the wrong folder, or have an old copy. Run it in the folder with this README, or in `Blockchain/`, `backend_test/`, `Frontend/` of this version. |
| PowerShell: *"running scripts is disabled on this system"* | Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then reopen the terminal (or use Command Prompt). |
| `Port 8545 is already in use` / chain stops at once | An older blockchain is still running — close that terminal (or end the `node` process) and retry. |
| The website shows **"Can't read the blockchain"** (e.g. *could not decode result data*) | The chain is running but the contracts aren't on it — it was restarted without deploying, or MetaMask points at a different/stale chain. The screen lists what it checked. Fix: stop everything (Ctrl+C), run `npm run dev` again (it starts a fresh chain **and** deploys), refresh the page, then in MetaMask use *Settings → Advanced → Clear activity tab data* and check the network's RPC URL is `http://127.0.0.1:8545`. |
| MetaMask shows an odd nonce / "transaction failed" after restarting the chain | MetaMask → Settings → Advanced → **Clear activity tab data** (a restarted chain is a brand-new chain). |
| `TransactionExecutionError: StackOverflow` / `Contract deployment: <UnrecognizedContract>` / *"function selector was not recognized"* in the chain output (older versions) | Harmless. These are read-only `eth_call` **simulations** that MetaMask sends on its own (they have no target address, so the node treats them as a contract deployment and runs random bytes). They never change the chain and are not a failed transaction. The chain window now hides them; only mined transactions (`✓` / `✗ … REVERTED`) and transactions the node refused are shown. Run `npm run dev -- --verbose` inside `Blockchain/` to print everything. |
| MetaMask says **"transaction failed"** although the chain window shows no `✗` line | The website now sends every transaction with a 50% gas margin (an exact estimate can run out of gas if another user's request lands first). If it still happens, do the *Clear activity tab data* step above, refresh, and retry. A `✗ … REFUSED … Nonce` line in the chain window confirms that cause. |
| Browser shows the app but nothing loads from the chain | Make sure MetaMask is on **Hardhat Localhost**; you can also browse the marketplace with no wallet connected. |
| First run is slow / fails while compiling | The Solidity compiler is downloaded once — check your internet connection and retry. |

## Tests

```bash
cd Blockchain && npm test      # 96 contract tests (also: `npm test` at this folder runs the same)
```
