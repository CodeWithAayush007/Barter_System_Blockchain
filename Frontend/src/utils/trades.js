// src/utils/trades.js
//
// Small helpers that turn a decorated trade (see decorateTrade in
// blockchain/barterService.js) into things the UI wants to say.

import { shortenAddress } from '../blockchain/provider'
import { disputeKindLabel } from './format'

/** True when the viewer has something they must do for this trade to move on. */
export function needsAction(trade) {
  switch (trade.status) {
    case 'pending':
      return trade.role === 'owner'
    case 'in_escrow':
      if (trade.cancelState === 'theirs') return true
      if (trade.listingType === 'barter') return !trade.iConfirmed
      // sell / buy: the buyer confirms receipt, the seller ships first
      return trade.iAmBuyer || (trade.iAmSeller && !trade.shipped)
    case 'awaiting_ratings':
      return trade.actions.includes('rate') || trade.actions.includes('finalize')
    case 'return_pending':
      return trade.actions.includes('markReturned') || trade.actions.includes('confirmReturn')
    default:
      return false
  }
}

/** One line telling the viewer what is going on / what is expected of them. */
export function tradeHint(trade) {
  const other = shortenAddress(trade.counterparty)
  const cancelNote =
    trade.cancelState === 'mine'
      ? ` You proposed calling this trade off — waiting for ${other} to answer.`
      : trade.cancelState === 'theirs'
        ? ` ${other} proposes calling this trade off.`
        : ''

  switch (trade.status) {
    case 'pending':
      return trade.role === 'owner'
        ? `${other} wants this. Accept to lock your stake and start the trade, or reject.`
        : `Waiting for ${other} to accept. Everything you locked is refunded if you cancel.`

    case 'in_escrow':
      if (trade.listingType === 'barter') {
        if (!trade.iConfirmed && trade.theyConfirmed) return `${other} has confirmed. Confirm once the exchange is done.${cancelNote}`
        if (trade.iConfirmed && !trade.theyConfirmed) return `You confirmed. Waiting for ${other} to confirm.${cancelNote}`
        return `Both stakes are locked. Make the exchange, then each confirm here — or open a dispute if it goes wrong.${cancelNote}`
      }
      if (trade.iAmBuyer) {
        return trade.shipped
          ? `${other} marked the item as shipped. Confirm once it is in your hands — or open a dispute if it isn't what was promised.${cancelNote}`
          : `Waiting for ${other} to send the item. Confirm when you have it; if it never comes or is wrong, open a dispute.${cancelNote}`
      }
      return trade.shipped
        ? `You marked it as shipped. Waiting for ${other} to confirm receipt. If they stay silent, open a dispute and the admin will rule.${cancelNote}`
        : `Send the item to ${other}, then mark it as shipped. They confirm receipt and you are paid.${cancelNote}`

    case 'awaiting_ratings':
      if (trade.actions.includes('rate')) return `Rate ${other} (1–5 stars). Your rating sets their bonus.`
      if (trade.actions.includes('finalize')) return 'The rating window has closed. Finalise to release the stakes.'
      return `You rated ${other}. Waiting for their rating (or the window to close).`

    case 'disputed': {
      const d = trade.dispute
      if (!d) return 'A dispute is open. The platform admin will rule on it.'
      const mine = d.raisedBy?.toLowerCase() === trade.myAddress?.toLowerCase()
      return `${mine ? 'You opened' : `${other} opened`} a dispute (${disputeKindLabel(d.kind, trade.listingType).toLowerCase()}). The platform admin will rule on it.`
    }

    case 'return_pending':
      if (trade.iAmBuyer) {
        return trade.dispute?.returnedAt
          ? 'You marked the item as returned. The payout is released when the seller confirms it arrived (or the admin closes the case).'
          : 'The admin ruled the item was not as described. Send it back to the seller and mark it returned — the payout is released once they confirm.'
      }
      return 'The admin ruled the item was not as described. Confirm here once the buyer\'s return reaches you — the payout is released then.'

    case 'completed':
      return 'Completed. Your stake was returned, plus your trade reward.'
    case 'resolved':
      return trade.outcome?.won ? 'The admin ruled in your favour.' : 'The admin ruled against you.'
    case 'rejected':
      return 'The owner declined. Everything you locked was returned.'
    case 'cancelled':
      return 'Cancelled. Everything you locked was returned.'
    case 'cancelled_in_escrow':
      return 'Called off by agreement. Everything that was locked was refunded to both of you.'
    default:
      return ''
  }
}

/** What each tab on the Trades page contains. */
export const TRADE_TABS = [
  { key: 'requests', label: 'Requests', statuses: ['pending'] },
  { key: 'active', label: 'In escrow', statuses: ['in_escrow', 'disputed', 'return_pending'] },
  { key: 'rating', label: 'Rate & settle', statuses: ['awaiting_ratings'] },
  { key: 'history', label: 'History', statuses: ['completed', 'resolved', 'rejected', 'cancelled', 'cancelled_in_escrow'] },
]

