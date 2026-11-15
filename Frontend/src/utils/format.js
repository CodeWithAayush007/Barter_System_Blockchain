// src/utils/format.js
import { formatUnits } from 'ethers'

// Reputation is expressed through the numbers themselves — average star
// rating and BTK earned from ratings — not a bucketed tier label like
// "Bronze/Silver/Gold". A wallet with no ratings yet just shows as new.
export function formatRating(averageRatingX100) {
  if (!averageRatingX100) return null
  return (Number(averageRatingX100) / 100).toFixed(2)
}

export function reputationSummary(ratingCount) {
  if (!ratingCount) return { label: 'New trader', color: 'text-parchment-muted' }
  if (ratingCount < 5) return { label: 'Getting started', color: 'text-signal-warn' }
  return { label: 'Active trader', color: 'text-ledger' }
}

// The platform has exactly three kinds of listing.
export const LISTING_TYPES = {
  barter: { label: 'Barter', verb: 'wants to trade for', color: 'text-copper' },
  sell: { label: 'Sell', verb: 'is selling', color: 'text-ledger' },
  buy: { label: 'Buy', verb: 'wants to buy', color: 'text-signal-warn' },
}
export const LISTING_TYPE_ORDER = ['barter', 'sell', 'buy']

export function listingTypeLabel(type) {
  return LISTING_TYPES[type]?.label || type
}

/** ETH amount → text. Accepts wei (bigint) or an already-in-ETH number/string. */
export function formatEth(amount) {
  if (amount === undefined || amount === null) return '0 ETH'
  const asNumber = typeof amount === 'bigint' ? Number(formatUnits(amount, 18)) : Number(amount)
  return `${asNumber.toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH`
}

/** BTK amount → text. Accepts wei (bigint) or an already-in-BTK number/string. */
export function formatBtk(amount) {
  if (amount === undefined || amount === null) return '0 BTK'
  const asNumber = typeof amount === 'bigint' ? Number(formatUnits(amount, 18)) : Number(amount)
  return `${asNumber.toLocaleString(undefined, { maximumFractionDigits: 3 })} BTK`
}

/** Same as formatBtk but with a leading + / − for ledgers. */
export function formatBtkSigned(wei, incoming) {
  return `${incoming ? '+' : '−'}${formatBtk(wei).replace(' BTK', '')}`
}

// ─── Trade lifecycle (mirrors BarterAgreement.TradeStatus) ───────────────────

// What the person looking at a trade card sees for each on-chain status.
export const TRADE_STATUS = {
  pending: { label: 'Awaiting owner', tone: 'warn' },
  in_escrow: { label: 'In escrow', tone: 'copper' },
  awaiting_ratings: { label: 'Awaiting ratings', tone: 'ledger' },
  completed: { label: 'Completed', tone: 'ledger' },
  rejected: { label: 'Rejected', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  disputed: { label: 'Under dispute', tone: 'danger' },
  resolved: { label: 'Dispute resolved', tone: 'muted' },
  return_pending: { label: 'Item being returned', tone: 'warn' },
  cancelled_in_escrow: { label: 'Called off', tone: 'muted' },
}

export const TONE_CLASSES = {
  warn: 'bg-signal-warn/10 text-signal-warn border-signal-warn/30',
  copper: 'bg-copper/10 text-copper border-copper/30',
  ledger: 'bg-ledger/10 text-ledger border-ledger/30',
  danger: 'bg-signal-danger/10 text-signal-danger border-signal-danger/30',
  muted: 'bg-parchment-muted/10 text-parchment-muted border-parchment-muted/20',
}

export function tradeStatusLabel(status) {
  return TRADE_STATUS[status]?.label || status
}

// The four steps of a trade that finishes normally, for the progress bar.
export const TRADE_STEPS = [
  { key: 'requested', label: 'Requested' },
  { key: 'escrow', label: 'Both locked' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'settled', label: 'Settled' },
]

/** How far along the 4-step bar a trade is: 0..3, or 4 when fully done. */
export function tradeStepIndex(status) {
  switch (status) {
    case 'pending': return 0
    case 'in_escrow':
    case 'disputed':
    case 'return_pending': return 1
    case 'awaiting_ratings': return 2
    case 'completed':
    case 'resolved': return 4
    default: return 0
  }
}

// ─── X from Y ────────────────────────────────────────────────────────────────

/**
 * A starting point for the BTK lock (X) from the ETH amount (Y), so the stake
 * is in proportion to the money at risk. It is only a suggestion: the listing
 * owner can type any X they like (at or above the platform minimum).
 */
export const BTK_PER_ETH = 200

export function suggestLock(ethAmount, minLockBtk = 1) {
  const eth = Number(ethAmount)
  if (!Number.isFinite(eth) || eth <= 0) return null
  const suggestion = Math.max(Number(minLockBtk) || 1, Math.round(eth * BTK_PER_ETH))
  return String(suggestion)
}

// ─── Disputes ───────────────────────────────────────────────────────────────

/** What the person raising a dispute is claiming (the wording depends on the listing type). */
export function disputeKindLabel(kind, listingType) {
  switch (kind) {
    case 'not_received':
      return 'Item never arrived'
    case 'not_as_described':
      return 'Not as described'
    case 'not_confirmed':
      return listingType === 'barter' ? 'Other side never confirmed' : 'Buyer never confirmed receipt'
    default:
      return kind
  }
}

/** One line describing what the admin decided. */
export function rulingLabel(ruling) {
  switch (ruling) {
    case 'claimant_right':
      return 'Claimant was right'
    case 'claimant_lying':
      return 'Claimant was not telling the truth'
    case 'seller_wins':
      return 'Seller wins'
    case 'buyer_wins_missing':
      return 'Buyer wins — item missing'
    case 'buyer_wins_not_as_described':
      return 'Buyer wins — not as described'
    default:
      return 'Not ruled yet'
  }
}

// ─── Time ───────────────────────────────────────────────────────────────────

export function timeAgo(dateInput) {
  if (!dateInput) return ''
  const date = new Date(dateInput)
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}

/** Block timestamps are unix *seconds*. */
export function unixAgo(seconds) {
  if (!seconds) return ''
  return timeAgo(Number(seconds) * 1000)
}

/** "3 days", "36 hours", "5 minutes" — for the rating window. */
export function formatDuration(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return '—'
  if (s % 86400 === 0) {
    const d = s / 86400
    return `${d} day${d === 1 ? '' : 's'}`
  }
  if (s >= 3600) {
    const h = Math.round(s / 3600)
    return `${h} hour${h === 1 ? '' : 's'}`
  }
  const m = Math.max(1, Math.round(s / 60))
  return `${m} minute${m === 1 ? '' : 's'}`
}

/** Time left until a unix-seconds deadline, e.g. "2 days left" / "closed". */
export function timeLeft(deadlineSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  const left = Number(deadlineSeconds) - nowSeconds
  if (left <= 0) return 'closed'
  return `${formatDuration(left)} left`
}
