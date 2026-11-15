// src/blockchain/barterService.js
//
// The ONE place the app talks to the barter smart contracts.
//
//   • Every state change a user makes (create a listing, request / accept /
//     reject / cancel a trade, ship, confirm, call a trade off, dispute, rate,
//     return an item, claim BTK ...) is a real transaction sent from this file.
//   • Every piece of state the UI shows about listings, trades, funds and
//     reputation is read back FROM THE CHAIN here.
//
// The Express/MongoDB backend is only used for things a blockchain is bad at
// (image files, sign-in sessions, a notification cache) and is never asked
// "what is the status of this trade?" — it can't declare one completed.
//
// This file is deliberately framework-free (no React) so it can be exercised
// in plain Node against a local node.

import { formatEther, formatUnits, parseUnits, ZeroAddress } from 'ethers'
import { getContract } from './contract'
import { getNetworkConfig } from './networks'

// ─── Rule constants (mirrors BarterAgreement.sol; read live where possible) ──

export const LISTING_TYPE_NAMES = ['barter', 'sell', 'buy']
export const TRADE_STATUS_NAMES = [
  'pending',
  'in_escrow',
  'awaiting_ratings',
  'completed',
  'rejected',
  'cancelled',
  'disputed',
  'resolved',
  'return_pending',
  'cancelled_in_escrow',
]
export const DISPUTE_KIND_NAMES = ['not_received', 'not_as_described', 'not_confirmed']
export const RULING_NAMES = [
  'none',
  'claimant_right',
  'claimant_lying',
  'seller_wins',
  'buyer_wins_missing',
  'buyer_wins_not_as_described',
]
export const RETURN_RESULT_NAMES = ['none', 'confirmed_by_seller', 'confirmed_by_admin', 'not_returned']

export const BONUS_PERCENT = 5
export const MAX_STARS = 5
export const MISSING_PENALTY_PERCENT = 30
export const NOT_AS_DESCRIBED_PENALTY_PERCENT = 15

/** 5% of the lock amount X per star. Works on wei (bigint) amounts. */
export function bonusFor(lockAmountWei, stars, bonusPercent = BONUS_PERCENT) {
  return (BigInt(lockAmountWei) * BigInt(bonusPercent) * BigInt(stars)) / 100n
}

// ─── Normalizers: ethers `Result` structs → plain objects ───────────────────

/** An Error whose message is already written for the end user (see utils/errors.js). */
function userError(message, code) {
  const err = new Error(message)
  err.userFacing = true
  if (code) err.chainCode = code
  return err
}

/** Parses "0.05" → wei, with a readable error for things like "1e-3" or "abc". */
function parseAmount(value, label) {
  try {
    return parseUnits(String(value).trim(), 18)
  } catch {
    throw userError(`${label} must be a plain decimal number such as 0.05.`)
  }
}

const nullIfZero = (addr) => (addr && addr !== ZeroAddress ? addr : null)
const lower = (addr) => (addr ? addr.toLowerCase() : null)

export function normalizeListing(l) {
  const typeIdx = Number(l.listingType)
  return {
    id: Number(l.id),
    owner: l.owner,
    ownerLower: l.owner.toLowerCase(),
    listingType: LISTING_TYPE_NAMES[typeIdx],
    title: l.itemName,
    category: l.category,
    description: l.description,
    seeking: l.wantedItem,
    imageHash: l.imageHash,
    // Y: the ETH amount the owner set. The price on SELL/BUY, the ETH deposit each side locks on a BARTER.
    priceWei: l.price,
    priceEth: formatEther(l.price),
    // X: the BTK each side locks.
    lockAmountWei: l.lockAmount,
    lockAmountBtk: formatUnits(l.lockAmount, 18),
    active: l.active,
    createdAt: Number(l.createdAt),
    updatedAt: Number(l.updatedAt),
  }
}

/**
 * NOTE on rating privacy: the two star values on a request (what each side
 * gave the other) are read here only so the service can tell whether someone
 * has rated yet. `decorateTrade` strips them before anything reaches the UI.
 */
export function normalizeRequest(r) {
  const statusCode = Number(r.status)
  return {
    id: Number(r.id),
    listingId: Number(r.listingId),
    requester: r.requester,
    requesterLower: r.requester.toLowerCase(),
    offeredItem: r.offeredItem,
    offeredDescription: r.offeredDescription,
    imageHash: r.imageHash,
    lockAmountWei: r.lockAmount,
    lockAmountBtk: formatUnits(r.lockAmount, 18),
    requesterEthWei: r.requesterEthLocked,
    ownerEthWei: r.ownerEthLocked,
    statusCode,
    status: TRADE_STATUS_NAMES[statusCode],
    ownerConfirmed: r.ownerConfirmed,
    requesterConfirmed: r.requesterConfirmed,
    ratingByOwner: Number(r.ratingByOwner), // stars the OWNER gave the requester (0 = none)
    ratingByRequester: Number(r.ratingByRequester), // stars the REQUESTER gave the owner (0 = none)
    ratingDeadline: Number(r.ratingDeadline),
    shipped: r.shipped,
    shippedAt: Number(r.shippedAt),
    shippingNote: r.shippingNote,
    cancelProposedBy: nullIfZero(r.cancelProposedBy),
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt),
  }
}

/** The dispute record of a request. `exists` is false when nobody ever disputed it. */
export function normalizeDispute(d) {
  const kindCode = Number(d.kind)
  const rulingCode = Number(d.ruling)
  const returnCode = Number(d.returnResult)
  const raisedBy = nullIfZero(d.raisedBy)
  return {
    exists: !!raisedBy,
    requestId: Number(d.requestId),
    raisedBy,
    kindCode,
    kind: DISPUTE_KIND_NAMES[kindCode],
    reason: d.reason,
    raisedAt: Number(d.raisedAt),
    rulingCode,
    ruling: RULING_NAMES[rulingCode],
    resolvedAt: Number(d.resolvedAt),
    winner: nullIfZero(d.winner),
    loser: nullIfZero(d.loser),
    winnerBonusWei: d.winnerBonus,
    burnedWei: d.burned,
    returnNote: d.returnNote,
    returnedAt: Number(d.returnedAt),
    returnResultCode: returnCode,
    returnResult: RETURN_RESULT_NAMES[returnCode],
    closedAt: Number(d.closedAt),
  }
}

/** Who is the buyer and who the seller. Both null on a barter, which has neither. */
export function rolesOf(listing, request) {
  if (listing.listingType === 'sell') return { buyer: request.requester, seller: listing.owner }
  if (listing.listingType === 'buy') return { buyer: listing.owner, seller: request.requester }
  return { buyer: null, seller: null }
}

/** What each party ends up with after a dispute is closed — straight from the dispute record. */
function disputePayout(me, request, listing, dispute) {
  const x = request.lockAmountWei
  const totalEth = request.requesterEthWei + request.ownerEthWei
  const won = lower(dispute.winner) === me
  const lost = lower(dispute.loser) === me
  const myEth = lower(request.requester) === me ? request.requesterEthWei : request.ownerEthWei

  // BTK: everyone gets X back, except the loser, whose stake is burned by `burned`.
  const btkBackWei = x - (lost ? dispute.burnedWei : 0n)
  // ETH: on a sell/buy it all goes to the winner; on a barter "right" it all goes to the claimant,
  // and on "lying" each side just gets its own deposit back.
  let ethToMeWei
  if (listing.listingType === 'barter') {
    ethToMeWei = dispute.ruling === 'claimant_right' ? (won ? totalEth : 0n) : myEth
  } else {
    ethToMeWei = won ? totalEth : 0n
  }
  return {
    won,
    btkBackWei,
    btkBurnedWei: lost ? dispute.burnedWei : 0n,
    ethToMeWei,
    bonusWei: won ? dispute.winnerBonusWei : 0n,
  }
}

/**
 * Joins a request with its listing (and its dispute record, if it has one) and works out everything the
 * UI needs from the point of view of `viewer`: their role, the counterparty, who has confirmed / rated,
 * what they can do next, what they have locked, and (once settled) what they got.
 *
 * Rating privacy: the stars the OTHER party gave are deliberately NOT part of the result, nor is the
 * bonus they imply. The viewer only learns whether they have rated yet, and whether the other side has.
 */
export function decorateTrade(request, listing, viewer, chainNow, dispute = null) {
  const me = viewer.toLowerCase()
  const role = listing.ownerLower === me ? 'owner' : 'requester'
  const isOwner = role === 'owner'
  const counterparty = isOwner ? request.requester : listing.owner
  const kind = listing.listingType
  const { buyer, seller } = rolesOf(listing, request)
  const iAmBuyer = !!buyer && buyer.toLowerCase() === me
  const iAmSeller = !!seller && seller.toLowerCase() === me
  // 'buyer' | 'seller' on a sell/buy; 'party' on a barter, where both sides are equal.
  const tradeRole = iAmBuyer ? 'buyer' : iAmSeller ? 'seller' : 'party'

  const iConfirmed = isOwner ? request.ownerConfirmed : request.requesterConfirmed
  const theyConfirmed = isOwner ? request.requesterConfirmed : request.ownerConfirmed
  const starsIGave = isOwner ? request.ratingByOwner : request.ratingByRequester
  const theyRated = (isOwner ? request.ratingByRequester : request.ratingByOwner) > 0

  const myEthWei = isOwner ? request.ownerEthWei : request.requesterEthWei
  const theirEthWei = isOwner ? request.requesterEthWei : request.ownerEthWei
  const status = request.status
  const windowOpen = chainNow <= request.ratingDeadline
  const hasDispute = !!dispute?.exists

  // What the viewer currently has sitting in escrow for this trade.
  let lockedBtkWei = 0n
  let lockedEthWei = 0n
  if (status === 'pending') {
    if (!isOwner) {
      lockedBtkWei = request.lockAmountWei
      lockedEthWei = request.requesterEthWei
    }
  } else if (['in_escrow', 'disputed', 'return_pending'].includes(status)) {
    lockedBtkWei = request.lockAmountWei
    lockedEthWei = myEthWei
  } else if (status === 'awaiting_ratings') {
    lockedBtkWei = request.lockAmountWei // the ETH was already paid out / returned
  }

  // ── what the viewer can do now ──
  const actions = []
  let disputeKinds = []
  let cancelState = 'none' // 'none' | 'mine' | 'theirs'
  if (request.cancelProposedBy) cancelState = lower(request.cancelProposedBy) === me ? 'mine' : 'theirs'

  if (status === 'pending') {
    if (isOwner) actions.push('accept', 'reject')
    else actions.push('cancel')
  } else if (status === 'in_escrow') {
    if (kind === 'barter') {
      if (!iConfirmed) actions.push('confirm')
      disputeKinds = ['not_received', 'not_as_described', 'not_confirmed']
    } else if (iAmBuyer) {
      actions.push('confirm')
      disputeKinds = ['not_received', 'not_as_described']
    } else if (iAmSeller) {
      if (!request.shipped) actions.push('ship')
      if (request.shipped) disputeKinds = ['not_confirmed']
    }
    if (disputeKinds.length) actions.push('dispute')
    if (cancelState === 'none') actions.push('proposeCancel')
    if (cancelState === 'mine') actions.push('withdrawCancel')
    if (cancelState === 'theirs') actions.push('acceptCancel', 'declineCancel')
  } else if (status === 'awaiting_ratings') {
    if (starsIGave === 0 && windowOpen) actions.push('rate')
    if (!windowOpen) actions.push('finalize')
  } else if (status === 'return_pending' && hasDispute) {
    if (iAmBuyer && !dispute.returnedAt) actions.push('markReturned')
    if (iAmSeller) actions.push('confirmReturn')
  }

  // ── what the viewer ended up with, once the trade is settled ──
  // (Never includes the rating bonus: that would reveal the stars the other side gave.)
  let outcome = null
  if (status === 'completed') {
    outcome = {
      kind: 'completed',
      btkBackWei: request.lockAmountWei,
      ethToMeWei: kind === 'barter' ? myEthWei : iAmSeller ? request.requesterEthWei + request.ownerEthWei : 0n,
      ethPaidWei: kind !== 'barter' && iAmBuyer ? request.requesterEthWei + request.ownerEthWei : 0n,
      btkBurnedWei: 0n,
      bonusWei: 0n,
    }
  } else if (status === 'resolved' && hasDispute) {
    outcome = {
      kind: 'resolved',
      ruling: dispute.ruling,
      returnResult: dispute.returnResult,
      iWasClaimant: lower(dispute.raisedBy) === me,
      ...disputePayout(me, request, listing, dispute),
    }
  } else if (['rejected', 'cancelled', 'cancelled_in_escrow'].includes(status)) {
    outcome = {
      kind: status,
      // A rejected / withdrawn request only ever had the requester's stake locked; a trade called off in escrow refunds both.
      btkBackWei: status === 'cancelled_in_escrow' || !isOwner ? request.lockAmountWei : 0n,
      ethToMeWei: myEthWei,
      btkBurnedWei: 0n,
      bonusWei: 0n,
    }
  }

  // Strip the other side's stars before anything leaves this function.
  // eslint-disable-next-line no-unused-vars
  const { ratingByOwner, ratingByRequester, ...safeRequest } = request

  return {
    ...safeRequest,
    listing,
    listingTitle: listing.title,
    listingType: kind,
    role,
    myAddress: viewer,
    direction: isOwner ? 'incoming' : 'outgoing',
    counterparty,
    buyer,
    seller,
    iAmBuyer,
    iAmSeller,
    tradeRole,
    iConfirmed,
    theyConfirmed,
    starsIGave, // what I gave — my own choice, safe to show
    theyRated, // whether they have rated yet (not what they gave)
    myEthWei,
    theirEthWei,
    lockedBtkWei,
    lockedEthWei,
    cancelState,
    disputeKinds,
    dispute: hasDispute ? dispute : null,
    windowOpen,
    actions,
    outcome,
  }
}

// ─── The service ────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.chainId   hex chain id, e.g. "0x7a69"
 * @param {object} opts.runner    an ethers Signer (can send txs) or Provider (read-only)
 * @param {string|null} opts.account  the connected wallet address, if any
 * @param {object} [opts.readProvider]  provider used for ALL reads. Passing the node's own RPC
 *        provider here means reads never depend on the wallet (MetaMask keeps a cached, sometimes
 *        stale view of a local chain that has been restarted). The wallet is only used to sign/send.
 */
export function createBarterService({ chainId, runner, account = null, readProvider = null }) {
  const canWrite = typeof runner.sendTransaction === 'function' && !!account
  const walletProvider = canWrite ? runner.provider ?? null : null
  const provider = readProvider ?? runner.provider ?? runner // where every read goes
  const rpcUrl = getNetworkConfig(chainId)?.rpcUrl ?? null

  // Read-only contracts (bound to the node) …
  const agreement = getContract('BarterAgreement', provider, chainId)
  const escrow = getContract('Escrow', provider, chainId)
  const token = getContract('BarterToken', provider, chainId)
  const reputation = getContract('Reputation', provider, chainId)
  // … and the same contracts bound to the wallet, used only to send transactions.
  const w = canWrite
    ? {
        agreement: getContract('BarterAgreement', runner, chainId),
        token: getContract('BarterToken', runner, chainId),
      }
    : null

  /** Throws unless a wallet is connected AND it is looking at the same chain the website reads. */
  async function requireSigner() {
    if (!canWrite) throw userError('Connect your wallet to do this.')
    if (walletProvider && walletProvider !== provider) {
      const address = await agreement.getAddress()
      let code = null
      try {
        code = await walletProvider.getCode(address)
      } catch {
        // can't tell — let the transaction itself report the problem
      }
      if (code === '0x') {
        throw userError(
          `MetaMask is connected to a different blockchain than this website is reading (it can't see the contracts at ${address}). ` +
            `In MetaMask, open the "Hardhat Localhost" network and make sure its RPC URL is ${rpcUrl ?? 'the same node the website uses'}. ` +
            `If you restarted the chain, also use MetaMask → Settings → Advanced → "Clear activity tab data".`,
          'WALLET_CHAIN_MISMATCH'
        )
      }
    }
  }

  /**
   * Is the chain reachable and are the contracts really deployed where the app expects them?
   * Throws a readable error (with chainCode 'NO_CONTRACT') when the node answers but nothing is there.
   */
  async function probe() {
    const address = await agreement.getAddress()
    const code = await provider.getCode(address) // throws if the node is unreachable
    if (code === '0x') {
      throw userError(
        `The blockchain is running, but there are no contracts at ${address}. The chain was most likely restarted. ` +
          `Run "npm run dev" in the project folder (or in Blockchain/) to deploy them again, then refresh this page.`,
        'NO_CONTRACT'
      )
    }
    await agreement.totalListings()
  }

  /** What the website and the wallet each see — used by the "Can't read the blockchain" screen. */
  async function diagnose() {
    const address = await agreement.getAddress()
    const inspect = async (p) => {
      try {
        const [net, block, code] = await Promise.all([p.getNetwork(), p.getBlockNumber(), p.getCode(address)])
        return { reachable: true, chainId: '0x' + net.chainId.toString(16), block, hasContract: code !== '0x' }
      } catch (err) {
        return { reachable: false, error: String(err?.shortMessage || err?.message || err).slice(0, 140) }
      }
    }
    const direct = await inspect(provider)
    const wallet = walletProvider && walletProvider !== provider ? await inspect(walletProvider) : null
    return { address, rpcUrl, direct, wallet }
  }

  async function chainNow() {
    const block = await provider.getBlock('latest')
    return Number(block.timestamp)
  }

  function parseAgreementEvent(receipt, eventName) {
    const agreementAddress = String(agreement.target).toLowerCase()
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== agreementAddress) continue
      try {
        const parsed = agreement.interface.parseLog(log)
        if (parsed?.name === eventName) return parsed
      } catch {
        // not an event from this ABI — keep looking
      }
    }
    return null
  }

  async function send(txPromise, onStep) {
    const tx = await txPromise
    onStep?.('Waiting for the block to be mined…')
    return tx.wait()
  }

  /**
   * Sends `contract.method(...args)` with a gas limit 50% ABOVE the node's estimate (MetaMask's own default).
   *
   * Why: the estimate is the *minimum* gas the transaction needed at the moment it was measured. When a
   * wallet is handed exactly that number there is no slack: if anything shifts before the block is mined
   * (another user's request lands first, so a loop runs one more round, or a call inside a try/catch is
   * starved by the 63/64 gas rule) the transaction runs out of gas and the wallet reports "Transaction
   * failed" — e.g. accepting a request while a second person requests the same listing. Unused gas is
   * refunded, so the margin costs nothing.
   *
   * A transaction that would revert still fails here, at the estimate, with the contract's own reason —
   * before the wallet pops up.
   */
  async function write(contract, method, args = [], overrides = {}) {
    const fn = contract.getFunction(method)
    const estimate = await fn.estimateGas(...args, overrides)
    return fn(...args, { ...overrides, gasLimit: (estimate * 150n) / 100n })
  }

  /** Makes sure the Escrow may pull `amount` BTK from the connected wallet. */
  async function ensureAllowance(amount, onStep) {
    const escrowAddress = await escrow.getAddress()
    const allowance = await token.allowance(account, escrowAddress)
    if (allowance >= amount) return
    onStep?.(`Approve ${formatUnits(amount, 18)} BTK for escrow in your wallet…`)
    await send(write(w.token, 'approve', [escrowAddress, amount]), onStep)
  }

  async function assertEnoughBtk(amount) {
    const balance = await token.balanceOf(account)
    if (balance < amount) {
      throw userError(
        `You need ${formatUnits(amount, 18)} BTK to lock for this trade but your wallet has ` +
          `${formatUnits(balance, 18)} BTK. Claim your starter BTK on the Tokens page first.`
      )
    }
  }

  async function assertEnoughEth(amount) {
    if (amount === 0n) return
    const balance = await provider.getBalance(account)
    if (balance < amount) {
      throw userError(
        `You need ${formatEther(amount)} ETH to lock for this trade (plus a little for gas) but your wallet has ` +
          `${formatEther(balance)} ETH.`
      )
    }
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** Live values of the platform rules, straight from the contract. */
  async function fetchRules() {
    const [bonusPercent, maxStars, ratingWindow, minimumLock, missingPenalty, describedPenalty] = await Promise.all([
      agreement.BONUS_PERCENT(),
      agreement.MAX_STARS(),
      agreement.ratingWindow(),
      agreement.minimumLockAmount(),
      agreement.MISSING_PENALTY_PERCENT(),
      agreement.NOT_AS_DESCRIBED_PENALTY_PERCENT(),
    ])
    return {
      bonusPercent: Number(bonusPercent),
      maxStars: Number(maxStars),
      ratingWindowSeconds: Number(ratingWindow),
      minimumLockWei: minimumLock,
      minimumLockBtk: formatUnits(minimumLock, 18),
      missingPenaltyPercent: Number(missingPenalty),
      notAsDescribedPenaltyPercent: Number(describedPenalty),
    }
  }

  /** Headline numbers for the landing page — plain counters read from the contract. */
  async function fetchStats() {
    const [listings, requests] = await Promise.all([agreement.totalListings(), agreement.totalRequests()])
    return { totalListings: Number(listings), totalTradeRequests: Number(requests) }
  }

  /** Every listing on chain, newest first, annotated with live trade state. */
  async function fetchListings() {
    const [listingIds, requestIds] = await Promise.all([
      agreement.getAllListingIds(),
      agreement.getAllRequestIds(),
    ])
    const [rawListings, rawRequests] = await Promise.all([
      listingIds.length ? agreement.getListingsBatch(Array.from(listingIds)) : [],
      requestIds.length ? agreement.getRequestsBatch(Array.from(requestIds)) : [],
    ])

    const inTrade = new Set()
    const pendingCount = new Map()
    for (const raw of rawRequests) {
      const r = normalizeRequest(raw)
      if (r.status === 'in_escrow' || r.status === 'disputed' || r.status === 'return_pending') inTrade.add(r.listingId)
      if (r.status === 'pending') pendingCount.set(r.listingId, (pendingCount.get(r.listingId) ?? 0) + 1)
    }

    return rawListings
      .map((raw) => {
        const l = normalizeListing(raw)
        const status = !l.active ? 'closed' : inTrade.has(l.id) ? 'in_trade' : 'open'
        return { ...l, status, pendingRequests: pendingCount.get(l.id) ?? 0 }
      })
      .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
  }

  /** Fetches dispute records for the ids that can have one, as a Map(requestId → dispute). */
  async function loadDisputes(requests) {
    const ids = requests
      .filter((r) => ['disputed', 'resolved', 'return_pending'].includes(r.status))
      .map((r) => r.id)
    if (!ids.length) return new Map()
    const raw = await agreement.getDisputesBatch(ids)
    return new Map(raw.map((d) => normalizeDispute(d)).map((d) => [d.requestId, d]))
  }

  /** Every trade the address is part of (as requester or as listing owner). */
  async function fetchTrades(address) {
    const [mine, incoming] = await Promise.all([
      agreement.getUserRequests(address),
      agreement.getOwnerRequests(address),
    ])
    const ids = [...new Set([...mine, ...incoming].map(Number))].sort((a, b) => b - a)
    if (!ids.length) return []

    const [rawRequests, now] = await Promise.all([agreement.getRequestsBatch(ids), chainNow()])
    const requests = rawRequests.map(normalizeRequest)
    const listingIds = [...new Set(requests.map((r) => r.listingId))]
    const [rawListings, disputes] = await Promise.all([agreement.getListingsBatch(listingIds), loadDisputes(requests)])
    const listingById = new Map(rawListings.map((l) => normalizeListing(l)).map((l) => [l.id, l]))

    return requests.map((r) => decorateTrade(r, listingById.get(r.listingId), address, now, disputes.get(r.id) ?? null))
  }

  /**
   * Everything the admin needs: the disputes waiting for a ruling, the "not as described" cases waiting for
   * the item to come back, and the full history of past disputes (newest first).
   */
  async function fetchAdminDisputes() {
    const ids = Array.from(await agreement.getAllDisputeIds()).map(Number)
    if (!ids.length) return { open: [], returns: [], history: [] }

    const rawDisputes = await agreement.getDisputesBatch(ids)
    const disputes = rawDisputes.map(normalizeDispute)
    const rawRequests = await agreement.getRequestsBatch(ids)
    const requests = rawRequests.map(normalizeRequest)
    const listingIds = [...new Set(requests.map((r) => r.listingId))]
    const rawListings = await agreement.getListingsBatch(listingIds)
    const listingById = new Map(rawListings.map((l) => normalizeListing(l)).map((l) => [l.id, l]))
    const requestById = new Map(requests.map((r) => [r.id, r]))

    const cases = disputes.map((dispute) => {
      const request = requestById.get(dispute.requestId)
      const listing = listingById.get(request.listingId)
      const { buyer, seller } = rolesOf(listing, request)
      const claimant = dispute.raisedBy
      const respondent = lower(claimant) === request.requesterLower ? listing.owner : request.requester
      // The admin sees the case, never the stars the parties may have given each other.
      // eslint-disable-next-line no-unused-vars
      const { ratingByOwner, ratingByRequester, ...safeRequest } = request
      return {
        ...dispute,
        request: safeRequest,
        listing,
        listingType: listing.listingType,
        status: request.status,
        buyer,
        seller,
        claimant,
        respondent,
        ownerEthWei: request.ownerEthWei,
        requesterEthWei: request.requesterEthWei,
        lockAmountWei: request.lockAmountWei,
        shipped: request.shipped,
        shippedAt: request.shippedAt,
        shippingNote: request.shippingNote,
      }
    })

    const byRecent = (a, b) => (b.closedAt || b.resolvedAt || b.raisedAt) - (a.closedAt || a.resolvedAt || a.raisedAt)
    return {
      open: cases.filter((c) => c.status === 'disputed').sort((a, b) => b.raisedAt - a.raisedAt),
      returns: cases.filter((c) => c.status === 'return_pending').sort((a, b) => b.resolvedAt - a.resolvedAt),
      history: cases.filter((c) => c.status === 'resolved').sort(byRecent),
    }
  }

  async function isAdmin(address) {
    if (!address) return false
    const owner = await agreement.owner()
    return owner.toLowerCase() === address.toLowerCase()
  }

  /** The platform admin's address. */
  async function fetchAdminAddress() {
    return agreement.owner()
  }

  async function fetchReputation(address) {
    const [rep, disputes] = await Promise.all([
      reputation.getReputation(address),
      reputation.getDisputeRecord(address),
    ])
    return {
      completedTrades: Number(rep.completedTradeCount),
      averageRating: Number(rep.averageRating), // x100 fixed point, 450 -> 4.50 stars
      ratingCount: Number(rep.ratingCount),
      tokensEarnedWei: rep.tokensEarned,
      firstTradeAt: Number(rep.firstTradeAt),
      lastTradeAt: Number(rep.lastTradeAt),
      disputesRaised: Number(disputes.raised),
      disputesWon: Number(disputes.won),
      disputesLost: Number(disputes.lost),
      tokensSlashedWei: disputes.tokensSlashed,
    }
  }

  /** Reputation for many owners at once (used to badge listing cards). */
  async function fetchReputations(addresses) {
    const unique = [...new Set(addresses.map((a) => a.toLowerCase()))]
    const entries = await Promise.all(
      unique.map(async (addr) => {
        try {
          const rep = await reputation.getReputation(addr)
          return [addr, { averageRating: Number(rep.averageRating), ratingCount: Number(rep.ratingCount) }]
        } catch {
          return [addr, { averageRating: 0, ratingCount: 0 }]
        }
      })
    )
    return new Map(entries)
  }

  async function fetchBalances(address) {
    const [btk, eth, claimed] = await Promise.all([
      token.balanceOf(address),
      provider.getBalance(address),
      token.hasClaimedStarterTokens(address),
    ])
    return {
      btkWei: btk,
      btk: formatUnits(btk, 18),
      ethWei: eth,
      eth: formatEther(eth),
      hasClaimedStarter: claimed,
    }
  }

  /** BTK movements for a wallet, labelled by what they were (from Transfer events). */
  async function fetchTokenHistory(address, limit = 25) {
    const escrowAddress = (await escrow.getAddress()).toLowerCase()
    const [sent, received] = await Promise.all([
      token.queryFilter(token.filters.Transfer(address, null)),
      token.queryFilter(token.filters.Transfer(null, address)),
    ])
    const me = address.toLowerCase()
    const all = [...sent, ...received]
    // A self-transfer shows up in both queries — de-duplicate by tx + log index.
    const seen = new Set()
    const unique = all.filter((e) => {
      const key = `${e.transactionHash}:${e.index}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    unique.sort((a, b) => b.blockNumber - a.blockNumber || b.index - a.index)

    const top = unique.slice(0, limit)
    const blocks = await Promise.all(top.map((e) => provider.getBlock(e.blockNumber)))

    return top.map((e, i) => {
      const from = e.args.from.toLowerCase()
      const to = e.args.to.toLowerCase()
      const incoming = to === me
      let type = 'transfer'
      let label
      if (from === ZeroAddress) {
        type = 'reward'
        label = 'Minted to you — starter grant or trade reward'
      } else if (to === ZeroAddress) {
        type = 'burn'
        label = 'Burned'
      } else if (to === escrowAddress) {
        type = 'escrow'
        label = 'Locked in escrow'
      } else if (from === escrowAddress) {
        type = 'escrow'
        label = 'Returned from escrow'
      } else {
        label = incoming ? `Received from ${e.args.from.slice(0, 6)}…${e.args.from.slice(-4)}` : `Sent to ${e.args.to.slice(0, 6)}…${e.args.to.slice(-4)}`
      }
      return {
        id: `${e.transactionHash}:${e.index}`,
        type,
        label,
        incoming,
        amountWei: e.args.value,
        timestamp: Number(blocks[i].timestamp),
      }
    })
  }

  // ── Writes (each one is a real transaction) ──────────────────────────────

  async function claimStarterTokens({ onStep } = {}) {
    await requireSigner()
    onStep?.('Confirm in your wallet…')
    const receipt = await send(write(w.token, 'claimStarterTokens'), onStep)
    return { txHash: receipt.hash }
  }

  async function transferToken(to, amountBtk, { onStep } = {}) {
    await requireSigner()
    onStep?.('Confirm in your wallet…')
    const receipt = await send(write(w.token, 'transfer', [to, parseAmount(amountBtk, 'The amount')]), onStep)
    return { txHash: receipt.hash }
  }

  /**
   * `priceEth` is Y: the price on a sell/buy, and the ETH deposit each side locks on a barter.
   * `lockBtk` is X. A sell listing must carry a photo (`imageHash`).
   */
  async function createListing(input, { onStep } = {}) {
    await requireSigner()
    const { listingType, title, category, description, seeking, imageHash, priceEth, lockBtk } = input
    const typeIdx = LISTING_TYPE_NAMES.indexOf(listingType)
    if (typeIdx < 0) throw userError('Listing type must be barter, sell or buy.')

    const priceWei = parseAmount(priceEth, listingType === 'barter' ? 'The ETH stake' : 'The price')
    if (priceWei <= 0n) throw userError(listingType === 'barter' ? 'The ETH stake must be more than zero.' : 'The price must be more than zero.')
    if (listingType === 'sell' && !imageHash) throw userError('A sell listing needs a photo of the item.')

    onStep?.('Confirm the new listing in your wallet…')
    const receipt = await send(
      write(w.agreement, 'createListing', [
        typeIdx,
        title,
        category,
        description,
        listingType === 'barter' ? seeking : '',
        imageHash || '',
        priceWei,
        parseAmount(lockBtk, 'The lock amount'),
      ]),
      onStep
    )
    const evt = parseAgreementEvent(receipt, 'ListingCreated')
    if (!evt) throw new Error('The transaction was mined but no ListingCreated event was found.')
    return { listingId: Number(evt.args.listingId), txHash: receipt.hash }
  }

  async function deactivateListing(listingId, { onStep } = {}) {
    await requireSigner()
    onStep?.('Confirm in your wallet…')
    const receipt = await send(write(w.agreement, 'deactivateListing', [listingId]), onStep)
    return { txHash: receipt.hash }
  }

  /**
   * Requester side: lock X BTK, plus the ETH this side owes (Y on a barter, the price on a sell; nothing on a buy).
   * `imageHash` is the SHA-256 of the photo of what the requester offers (the file itself goes to the backend).
   */
  async function requestTrade({ listing, offeredItem, offeredDescription, imageHash }, { onStep } = {}) {
    await requireSigner()
    await assertEnoughBtk(listing.lockAmountWei)
    const value = await agreement.requesterEthRequired(listing.id)
    await assertEnoughEth(value)
    await ensureAllowance(listing.lockAmountWei, onStep)
    onStep?.('Confirm the trade request in your wallet…')
    const receipt = await send(
      write(w.agreement, 'requestTrade', [listing.id, offeredItem || '', offeredDescription || '', imageHash || ''], { value }),
      onStep
    )
    const evt = parseAgreementEvent(receipt, 'TradeRequested')
    return { requestId: evt ? Number(evt.args.requestId) : null, txHash: receipt.hash }
  }

  /** Owner side: lock the matching X BTK (and Y ETH on a barter or a buy) and move the trade into escrow. */
  async function acceptTrade(trade, { onStep } = {}) {
    await requireSigner()
    await assertEnoughBtk(trade.lockAmountWei)
    const value = await agreement.ownerEthRequired(trade.listingId)
    await assertEnoughEth(value)
    await ensureAllowance(trade.lockAmountWei, onStep)
    onStep?.('Confirm accepting this trade in your wallet…')
    const receipt = await send(write(w.agreement, 'acceptTradeRequest', [trade.id], { value }), onStep)
    return { txHash: receipt.hash }
  }

  async function simpleTradeCall(method, args, { onStep } = {}) {
    await requireSigner()
    onStep?.('Confirm in your wallet…')
    const receipt = await send(write(w.agreement, method, args), onStep)
    return { txHash: receipt.hash }
  }

  const rejectTrade = (id, opts) => simpleTradeCall('rejectTradeRequest', [id], opts)
  const cancelTrade = (id, opts) => simpleTradeCall('cancelTradeRequest', [id], opts)
  const confirmCompletion = (id, opts) => simpleTradeCall('confirmTradeCompletion', [id], opts)
  const finalizeTrade = (id, opts) => simpleTradeCall('finalizeTrade', [id], opts)

  /** Seller (sell/buy): "I have sent / handed over the item". Gives the seller the right to dispute a silent buyer. */
  const markShipped = (id, note, opts) => simpleTradeCall('markShipped', [id, note || ''], opts)

  /** Call a trade off once everything is locked — takes both parties' agreement. */
  const proposeCancel = (id, opts) => simpleTradeCall('proposeCancel', [id], opts)
  const acceptCancel = (id, opts) => simpleTradeCall('respondCancel', [id, true], opts)
  /** Used both by the other side (declines) and by the proposer (withdraws). */
  const declineCancel = (id, opts) => simpleTradeCall('respondCancel', [id, false], opts)

  /** `kind` is one of DISPUTE_KIND_NAMES. */
  async function raiseDispute(tradeId, kind, reason, opts) {
    const code = DISPUTE_KIND_NAMES.indexOf(kind)
    if (code < 0) throw userError('Choose what went wrong before opening a dispute.')
    return simpleTradeCall('raiseDispute', [tradeId, code, reason || ''], opts)
  }

  /** Buyer: "I have sent the item back" (informational — the seller / admin confirms). */
  const markReturned = (id, note, opts) => simpleTradeCall('markReturned', [id, note || ''], opts)
  /** Seller: "the returned item arrived" — releases the payout. */
  const confirmReturnReceived = (id, opts) => simpleTradeCall('confirmReturnReceived', [id], opts)

  async function rateCounterparty(tradeId, stars, { onStep } = {}) {
    await requireSigner()
    onStep?.('Confirm your rating in your wallet…')
    const receipt = await send(write(w.agreement, 'rateCounterparty', [tradeId, stars]), onStep)
    return { txHash: receipt.hash }
  }

  /** Admin only — `ruling` is one of RULING_NAMES. The contract rejects anyone else. */
  async function resolveDispute(tradeId, ruling, { onStep } = {}) {
    const code = RULING_NAMES.indexOf(ruling)
    if (code <= 0) throw userError('Choose a ruling first.')
    await requireSigner()
    onStep?.('Confirm your ruling in your wallet…')
    const receipt = await send(write(w.agreement, 'resolveDispute', [tradeId, code]), onStep)
    return { txHash: receipt.hash }
  }

  /** Admin only — closes a "not as described" return that is stuck: `returned` true pays the buyer, false the seller. */
  const adminCloseReturn = (id, returned, opts) => simpleTradeCall('adminCloseReturn', [id, !!returned], opts)

  return {
    chainId,
    account,
    canWrite,
    contracts: { agreement, escrow, token, reputation },
    probe,
    diagnose,
    // reads
    fetchRules,
    fetchStats,
    fetchListings,
    fetchTrades,
    fetchAdminDisputes,
    isAdmin,
    fetchAdminAddress,
    fetchReputation,
    fetchReputations,
    fetchBalances,
    fetchTokenHistory,
    // writes
    claimStarterTokens,
    transferToken,
    createListing,
    deactivateListing,
    requestTrade,
    acceptTrade,
    rejectTrade,
    cancelTrade,
    markShipped,
    confirmCompletion,
    proposeCancel,
    acceptCancel,
    declineCancel,
    raiseDispute,
    markReturned,
    confirmReturnReceived,
    finalizeTrade,
    rateCounterparty,
    resolveDispute,
    adminCloseReturn,
  }
}
