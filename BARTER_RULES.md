# Trove — Barter, Buy & Sell Rules, and What Lives Where

This is the rulebook from the three workflow diagrams (**BTK & ETH trade workflow** for barter,
**BUY option workflow** and **SELL option workflow**), written down exactly as the smart contract
enforces it. Every number below is computed on-chain by `BarterAgreement.sol` — the website only
displays it.

---

## 1. Listing types and the two amounts, `X` and `Y`

| Type | What it is | Owner (User A) is | Requester (User B) is |
|---|---|---|---|
| **Barter** | Item-for-item swap | one of two equal parties | the other equal party |
| **Sell** | The owner sells an item for ETH | the **seller** | the **buyer** |
| **Buy** | The owner wants an item and offers ETH | the **buyer** | the **seller** |

The listing owner sets two amounts when creating the listing. Neither can be changed afterwards.

* **`X` — the BTK stake.** Minimum **1 BTK** (admin can change it). BTK is the platform token; every
  new wallet can claim **100 BTK once** on the Tokens page.
* **`Y` — the ETH amount, always greater than zero.** The *price* on a Sell, the *offer* on a Buy,
  and the *ETH deposit each side locks* on a Barter.

A **Sell listing must carry a photo of the item** (the contract refuses a sell listing without a
photo fingerprint). Barter and Buy photos are optional.

## 2. What each side locks, and when

The requester locks at **request** time. The owner locks at **accept** time (not at listing time, so
an unwanted listing never ties up the owner's funds).

| Type | User B (requester) locks on request | User A (owner) locks on accept | Held in escrow |
|---|---|---|---|
| **Barter** | `X` BTK + `Y` ETH | `X` BTK + `Y` ETH | 2X BTK + 2Y ETH |
| **Sell** | `X` BTK + `Y` ETH (buyer) | `X` BTK (seller) | 2X BTK + Y ETH |
| **Buy** | `X` BTK (seller) | `X` BTK + `Y` ETH (buyer) | 2X BTK + Y ETH |

* In every type the **buyer locks X + Y** and the **seller locks X**; on a barter both sides lock X + Y.
* When the owner accepts one request, all **other pending requests** on that listing are automatically
  rejected and refunded.
* The owner can **reject** a pending request, and the requester can **cancel** it; either way the
  requester gets everything back.
* **One pending request per wallet per listing.**
* **The admin cannot trade** — the contract rejects `createListing` and `requestTrade` from the admin wallet.

### Request photo

When requesting a **barter** or **buy** listing, the requester can attach a **photo of what they are
offering and its condition**, plus a text description. The owner sees both next to the request before
deciding. Only the photo's SHA-256 fingerprint goes on the chain (with the request); the file lives on
the backend and is only accepted if (a) the uploader is the on-chain requester and (b) the file's hash
equals the fingerprint. The app offers no photo on a Sell request (the buyer is not offering an item).

## 3. The trade, step by step

### Barter

1. A lists (X, Y). 2. B requests and locks **X + Y**. 3. A accepts and locks **X + Y**.
4. They swap the goods off-chain. 5. **Each presses "Confirm exchange done".** The moment *both* have
   confirmed, each side's **own Y ETH comes back at once** and the 3-day rating window opens (the BTK
   stays locked). 6. No dispute → both rate 1–5 ★.

### Sell and Buy

1. A lists. 2. B requests (locks as in the table). 3. A accepts (locks as in the table).
4. The **seller sends the item and presses "Mark as shipped"** (optional tracking note).
5. **Only the buyer confirms** ("Confirm item received"). At that moment the **seller is paid Y ETH**
   and the 3-day rating window opens (the BTK stays locked). 6. No dispute → both rate 1–5 ★.

## 4. Payout for a smooth trade (no dispute)

Each person gets back

> **their own `X` + 5 % of `X` × (stars the *other* person gave them)** — the bonus is newly minted BTK.

With `X = 100 BTK`: 1★ → 105 · 3★ → 115 · **5★ → 125 BTK**.

* When both have rated, the trade settles immediately.
* If someone does not rate before the window closes, **anyone** can press *Finalise*; whoever was left
  unrated gets the default **5★** bonus and both stakes are returned.

## 5. Disputes

A dispute can only be opened while the trade is **in escrow** (before the exchange is confirmed). The
person who opens it is the **claimant**. The **admin** reads both sides and records a ruling. Every
dispute — open or settled — stays in the **admin's dispute history**.

### Who may open which dispute

| Type | Buyer | Seller |
|---|---|---|
| **Barter** | any time in escrow (item never arrived / not as described / other side never confirmed) — **either party** may | same |
| **Sell / Buy** | any time in escrow: **"item never arrived"** or **"not as described"** | **only "the buyer never confirmed"**, and **only after the item has been marked as shipped** |

This closes the gap where a buyer simply never confirms: the seller (who has shipped) can dispute.

### Barter rulings

| Admin rules… | Claimant gets | Other party gets |
|---|---|---|
| **Claimant is right** | `X` + 25 % of `X` (5★ bonus) **and all the ETH (2Y)** | **0** — their `X` is **burned**, their `Y` goes to the claimant |
| **Claimant is lying** | `X` + `Y` back — **no bonus** | `X` + `Y` back **+ 25 % of `X`** (5★ bonus) |

### Sell / Buy rulings (whoever opened the dispute)

| Admin rules… | Seller gets | Buyer gets |
|---|---|---|
| **Seller wins** (dispute untrue, or the buyer never confirmed) | `Y` ETH + `X` + 25 % of `X` | `X` back, **no bonus** |
| **Buyer wins — item missing** | **70 % of `X`** (30 % burned) | `Y` ETH + `X` back, no bonus |
| **Buyer wins — not as described** | **85 % of `X`** (15 % burned) | `Y` ETH + `X` + 25 % of `X` |

For **"not as described"** nothing is paid when the admin rules. The case moves to *return pending*:

1. The buyer sends the item back and presses **"I sent the item back"** (informational, with a note).
2. The seller presses **"Item returned to me"** — or the admin closes the case. Then the payout above is made.
3. If the buyer **never returns the item**, the admin closes the case with **"Never returned — pay the
   seller"**, which pays out as **Seller wins**.

Burned BTK is **burned** (removed from supply), not paid to anyone.

## 6. Calling a trade off after everything is locked

Once a trade is **in escrow** (all types), either party can **propose to call it off**. If the other
party **agrees**, everything is refunded to both — **no bonus, no penalty** — the trade is closed as
*called off by agreement*, and **the listing stays open** for new requests. The other party can also
decline, and the proposer can withdraw. Opening a dispute clears any pending proposal. If only one side
wants out, the options are to wait, or to open a dispute when there is a real problem.

## 7. Reputation, and what you can see

* The **Reputation** contract records trades, ratings, disputes and bonuses per wallet. Only
  `BarterAgreement` can write to it.
* **You are never shown what others rated you.** The app shows you only the stars *you* gave, and
  whether the other side has rated yet. Other traders see your *average* rating and badges when deciding
  whether to trade with you. Your own Reputation page hides your average and rating count; the activity
  feed says "your partner has rated you" without a number; trade cards show a bonus only to a dispute
  winner.
* The **admin has no reputation** and no trading — the admin's Reputation page says so, and the
  admin's Dashboard/Create/Trades/Tokens pages are replaced by "The admin does not trade".

> This privacy is enforced **in the app**, not by the chain: blockchain data is public, so a technical
> user can still read the raw `TradeRated` events or notice a minted bonus in the BTK transfer list.

## 8. Assumptions to confirm with the group

The diagrams do not spell these out, so the contract makes these choices:

1. **Cancelling after locking is by agreement** (proposal + acceptance), not unilateral, so one side
   cannot pull out after the other has locked. It applies to barter too.
2. **Either party can dispute a barter** (the diagram's claimant can be either side).
3. **The seller can dispute only after "Mark as shipped"**, and only with "the buyer never confirmed".
4. An item that is **never returned** after "not as described" is closed by the **admin** as a seller win.
5. **Burned BTK is burned**, not paid to the other side or the admin.
6. **The requester's stake is locked at request time**, so a requester may wait for a decision with their
   funds locked (they can cancel any time while pending).
7. **There is no admin deadline** — a disputed trade stays frozen until the admin rules.
8. **The admin is one trusted wallet** (the deployer). `transferOwnership` is allowed only to a wallet that
   has never traded; `renounceOwnership` is disabled.
9. **A listing cannot be edited** after creation (`updateListing` was removed so Y, X and the photo
   fingerprint cannot change under a requester).
10. The app suggests `X ≈ 200 BTK per 1 ETH` when you type a price. It is only a starting point: you can
    set any X ≥ the minimum.

---

## 9. What is stored where

### On the blockchain (authoritative)

| Data | Contract |
|---|---|
| Listings: owner, type, title, category, description, wanted item, **Y (price)**, **X (lock)**, photo fingerprint, open/closed | `BarterAgreement` |
| Every trade request and its lifecycle: requester, offered item/description, **request photo fingerprint**, locked amounts (X, requester ETH, owner ETH), status, who confirmed, ratings, rating deadline, shipped flag + note, cancel proposal | `BarterAgreement` |
| Every **dispute**: who raised it, kind, reason, ruling, winner/loser, bonus, burned amount, return note and result — the dispute history | `BarterAgreement` |
| **The money**: ETH and BTK held for every open trade, and every payout / refund / burn | `Escrow` |
| BTK balances, allowances, transfers, minted bonuses, burned stakes | `BarterToken` |
| Reputation ledger | `Reputation` |
| Rules: bonus %, minimum X, rating window, who the admin is | `BarterAgreement` |

### Off-chain (helper data only — cannot change any outcome above)

| Data | Where | Why not on-chain |
|---|---|---|
| **Listing photos** and **request photos** (files) | Backend `uploads/` | Too big for a chain. A file is only accepted if its SHA-256 matches the fingerprint committed on-chain by the right wallet. |
| Sign-in sessions, nonces, profiles | MongoDB | Not trade data. |
| Activity feed (notifications) | MongoDB | A convenience cache written only from *mined transaction receipts*; it never contains star counts or bonus amounts. |
| Search metadata cache of listings, photo records | MongoDB | Copied from the chain; **no status field**. |

> The database **cannot** mark a listing as sold, a trade as completed, or move any funds. If the whole
> database were wiped, the marketplace, every trade, balance, dispute and reputation score would still
> be there — only the photos (re-upload), the activity feed and the sign-in sessions would need rebuilding.
