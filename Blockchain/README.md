# Trove — Smart Contracts (Hardhat)

Solidity 0.8.20, Hardhat 2 (plain-JS `hardhat.config.js`, no TypeScript needed), OpenZeppelin 5, ethers v6. Four contracts make up the platform;
**the blockchain is the authority for listings, trade status and funds** — the web app and the
database only mirror it. The rules they enforce are written up in `../BARTER_RULES.md`.

| Contract | Job |
|---|---|
| `BarterToken` | **BTK** ERC-20. 1 M minted to the deployer, 100 M hard cap, anyone can claim **100 BTK once** (`claimStarterTokens`), burnable. Only the `Reputation` contract may mint (the trade bonuses). |
| `Escrow` | Holds the **ETH and the X BTK of both traders** while a trade runs. Only `BarterAgreement` can move funds out: refund, pay the seller, return stakes, or burn a slashed stake. |
| `BarterAgreement` | Listings (**Barter / Sell / Buy**), trade requests and the whole trade state machine: request → accept → (ship) → confirm → rate → settle, plus reject, cancel, **cancel-in-escrow by agreement**, dispute, return and the admin's ruling. Calculates every payout and keeps the **dispute history**. |
| `Reputation` | Per-wallet ledger written only by `BarterAgreement`: completed trades, star totals, disputes raised / won / lost, bonus BTK earned, BTK slashed. Mints the 5 %-per-star bonuses. |

Admin = the deployer wallet (`owner()` of `BarterAgreement`). It is the arbiter who rules on disputes
(the one discretionary power over funds — it decides who wins a disputed trade), and it can tune the
minimum lock amount and rating window. **The admin cannot trade**: `createListing` and `requestTrade` revert for it,
and `transferOwnership` only accepts a wallet that has never traded (`renounceOwnership` is disabled). It can **not** edit anyone's listing or re-point the Escrow
(that link is set once at deployment and then frozen). It is, however, a **trusted** role: the same
wallet holds the token's admin role, so it can authorise new BTK minters. For anything beyond a
prototype, hand it to a multisig and renounce the token admin role after deployment.

## Commands

```bash
npm install
npm run dev          # EASIEST: starts the local chain AND deploys the contracts (leave it running)
npm run dev:demo     # same, plus a few demo listings
npm run compile      # compile the contracts
npm test             # 96 tests: every rule in BARTER_RULES.md, access control, refunds, edge cases
npm run node         # start a local chain at http://127.0.0.1:8545 (chain id 31337) — leave it running
npm run deploy:local # deploy + wire the 4 contracts, then copy ABIs/addresses to Frontend and backend_test
npm run seed:demo    # optional: a few demo listings (barter, sell with a photo hash, buy) and one pending request on a fresh chain
```

`npm run dev` = `npm run node` + `npm run deploy:local` in one go (if a chain is already running on
port 8545 it just deploys onto it). Use the separate commands only if you want them in two terminals.

`deploy:local` must be re-run whenever you restart `npm run node` (a restarted node is an empty
chain). On a fresh node the addresses are always the same.

`deploy.js` writes:

- `Blockchain/deployments.json` — addresses of this deployment
- `Frontend/src/blockchain/deployed.json` and `abi/*.json` — what the app reads
- `backend_test/src/chain/deployed.json` and `abi.json` — what the API uses to verify photos/events

## What the tests cover (`test/BarterPlatform.test.js`, 96 tests)

- **Listings** — three types; **Y (ETH) > 0 on all three** (barter deposit / sell price / buy offer);
  X ≥ minimum; a sell listing **must carry a photo hash**; a listing can't be closed while a trade is active.
- **What gets locked** — barter: both lock X + Y; sell/buy: the seller locks X, the buyer locks X + Y; the requester
  locks at request, the owner at accept; exact-ETH enforcement; duplicate pending request blocked; the other
  pending requests are rejected and refunded on accept.
- **Request photo** — stored with the request and readable by the owner.
- **No-dispute trades** — barter: each side's Y returns at once when both confirm; sell/buy: only the buyer can
  confirm and the seller is paid Y at that moment; ratings pay `X + 5 % × X × stars`; default 5★ on `finalizeTrade`.
- **Who may dispute** — barter: either party; sell/buy: the buyer any time in escrow, the seller only
  "buyer never confirmed" and only after `markShipped`.
- **Rulings** — barter right/lying; sell/buy seller-wins, buyer-wins-missing (70 % / 30 % burned),
  buyer-wins-not-as-described (return flow, 85 % / 15 % burned, `adminCloseReturn`), for both SELL and BUY.
- **Cancel in escrow** — propose / accept / decline / withdraw; full refund, listing re-opens; a stranger cannot.
- **Admin** — cannot list or request, ownership transfer rules, **dispute history getters**, only the admin rules.
- **Access control and conservation** — only `BarterAgreement` can drive the Escrow or write the Reputation ledger
  (impersonation tests); after many mixed trades the Escrow holds exactly what is still locked.
- **Refund paths** — reject and cancel return every wei/BTK.

## Prototype limitations (also listed in the project report)

- One trusted admin rules on disputes (no multisig / DAO, no evidence upload, **no admin timeout** — a disputed trade stays frozen until the admin rules).
- Cancelling an escrowed trade needs **both** sides to agree; if only one wants out and there is no real problem, there is no unilateral exit.
- Ratings are public on-chain (the app hides them from the person rated; the chain cannot).
- `updateListing` no longer exists: a listing's X, Y and photo fingerprint can't change once requesters may have locked funds.
- No timeout if a trade sits in escrow and nobody confirms or disputes.
- Bonuses are *minted* — a pair of colluding wallets can farm bonus BTK; there is no cap per wallet
  or detection of self-dealing (the 100 M cap and the minimum lock only bound it).
- Listings and requests are listed by reading all ids; large chains need an event indexer.
- `contracts/MainProject.sol` is a leftover "hello world" from the template and is not used.
