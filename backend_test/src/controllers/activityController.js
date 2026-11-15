// src/controllers/activityController.js
import { formatUnits } from 'ethers'
import Activity from '../models/Activity.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { asChainError, getChain, LISTING_TYPE_NAMES } from '../chain/client.js'

// GET /api/activity/:address
export const getActivity = asyncHandler(async (req, res) => {
  const address = req.params.address.toLowerCase()
  const limit = Math.min(100, parseInt(req.query.limit) || 20)
  const items = await Activity.find({ user: address }).sort({ createdAt: -1 }).limit(limit)
  res.json(items)
})

// PATCH /api/activity/:id/read  (auth required)
export const markRead = asyncHandler(async (req, res) => {
  const activity = await Activity.findById(req.params.id)
  if (!activity) throw new ApiError(404, 'Activity not found.')
  if (activity.user !== req.user.address) throw new ApiError(403, 'Not your notification.')
  activity.read = true
  await activity.save()
  res.json(activity)
})

const btk = (wei) => Number(formatUnits(wei, 18)).toLocaleString('en-US', { maximumFractionDigits: 3 })

// DisputeKind / Ruling / ReturnResult enum order, as in BarterAgreement.sol.
const KIND_TEXT = ['the item never arrived', 'the item was not as described', 'the other side never confirmed']
const RULING = { NONE: 0, CLAIMANT_RIGHT: 1, CLAIMANT_LYING: 2, SELLER_WINS: 3, BUYER_WINS_MISSING: 4, BUYER_WINS_NOT_AS_DESCRIBED: 5 }

/**
 * Turns the BarterAgreement events in a mined transaction into feed rows.
 *
 * `lookup.parties(requestId)` returns { owner, requester, title, listingType } for a trade.
 * Pure apart from `lookup`, so it is easy to test.
 *
 * Rating privacy: the feed is public (anyone can ask for a wallet's activity), so
 * it never says how many stars somebody gave — nor the BTK bonus, which would
 * give the stars away. It only says THAT a rating happened.
 */
export async function activityFromLog(parsed, lookup) {
  const a = parsed.args
  const rows = []
  const add = (user, type, message, meta = {}) => rows.push({ user: String(user).toLowerCase(), type, message, meta })
  const id = Number(a.requestId ?? 0)
  const same = (x, y) => String(x).toLowerCase() === String(y).toLowerCase()
  const otherOf = (p, me) => (same(me, p.owner) ? p.requester : p.owner)

  switch (parsed.name) {
    case 'ListingCreated':
      add(a.owner, 'listing_created', `You listed "${a.itemName}" (listing #${a.listingId}) on-chain.`, { listingId: Number(a.listingId) })
      break

    case 'TradeRequested': {
      const p = await lookup.parties(a.requestId)
      add(a.requester, 'trade_requested', `You requested "${p.title}" (trade #${id}) and locked your stake.`, { requestId: id })
      add(p.owner, 'trade_requested', `New trade request #${id} on your listing "${p.title}".`, { requestId: id })
      break
    }

    case 'TradeAccepted': {
      const p = await lookup.parties(a.requestId)
      add(a.listingOwner, 'trade_accepted', `You accepted trade #${id} on "${p.title}" — both stakes are locked.`, { requestId: id })
      add(p.requester, 'trade_accepted', `Your request #${id} on "${p.title}" was accepted — both stakes are locked.`, { requestId: id })
      break
    }

    case 'TradeRejected': {
      const p = await lookup.parties(a.requestId)
      add(p.requester, 'trade_rejected', `Your request #${id} was rejected. Everything you locked was returned.`, { requestId: id })
      break
    }

    case 'TradeRequestCancelled':
      add(a.requester, 'trade_cancelled', `You cancelled request #${id}. Everything you locked was returned.`, { requestId: id })
      break

    case 'TradeShipped': {
      const p = await lookup.parties(a.requestId)
      add(a.seller, 'trade_shipped', `You marked trade #${id} as shipped.`, { requestId: id })
      add(otherOf(p, a.seller), 'trade_shipped', `The seller marked trade #${id} as shipped. Confirm once you have the item — or open a dispute if something is wrong.`, { requestId: id })
      break
    }

    case 'TradeConfirmed': {
      const p = await lookup.parties(a.requestId)
      if (p.listingType === 'barter') {
        add(a.confirmer, 'trade_confirmed', `You confirmed the exchange for trade #${id}.`, { requestId: id })
        add(otherOf(p, a.confirmer), 'trade_confirmed', `The other side confirmed the exchange for trade #${id}. Confirm yours once it's done.`, { requestId: id })
      } else {
        add(a.confirmer, 'trade_confirmed', `You confirmed you received the item for trade #${id}.`, { requestId: id })
      }
      break
    }

    case 'ExchangeConfirmed': {
      const p = await lookup.parties(a.requestId)
      for (const u of [p.owner, p.requester]) {
        add(u, 'trade_confirmed', `Trade #${id} is confirmed. Rate each other to release your stake.`, { requestId: id })
      }
      break
    }

    case 'TradeRated':
      add(a.rater, 'trade_rated', `You rated your partner on trade #${id}.`, { requestId: id })
      add(a.rated, 'trade_rated', `Your partner has rated you on trade #${id}.`, { requestId: id })
      break

    case 'TradeCompleted':
      add(a.listingOwner, 'trade_completed', `Trade #${id} completed. Your stake was returned, plus your trade reward.`, { requestId: id })
      add(a.requester, 'trade_completed', `Trade #${id} completed. Your stake was returned, plus your trade reward.`, { requestId: id })
      break

    case 'CancelProposed': {
      const p = await lookup.parties(a.requestId)
      add(a.proposer, 'trade_cancel_proposed', `You proposed calling off trade #${id}. Waiting for the other side.`, { requestId: id })
      add(otherOf(p, a.proposer), 'trade_cancel_proposed', `The other side proposes calling off trade #${id}. Agree or decline on the Trades page.`, { requestId: id })
      break
    }

    case 'CancelProposalCleared': {
      const p = await lookup.parties(a.requestId)
      const other = otherOf(p, a.by)
      if (a.declined) {
        add(a.by, 'trade_cancel_cleared', `You declined to call off trade #${id}. It carries on.`, { requestId: id })
        add(other, 'trade_cancel_cleared', `The other side declined to call off trade #${id}. It carries on.`, { requestId: id })
      } else {
        add(a.by, 'trade_cancel_cleared', `You withdrew your proposal to call off trade #${id}.`, { requestId: id })
        add(other, 'trade_cancel_cleared', `The proposal to call off trade #${id} was withdrawn. It carries on.`, { requestId: id })
      }
      break
    }

    case 'TradeCancelledInEscrow': {
      const p = await lookup.parties(a.requestId)
      for (const u of [p.owner, p.requester]) {
        add(u, 'trade_cancelled_in_escrow', `Trade #${id} was called off by agreement. Everything locked was refunded.`, { requestId: id })
      }
      break
    }

    case 'TradeDisputed': {
      const p = await lookup.parties(a.requestId)
      const why = KIND_TEXT[Number(a.kind)] ?? 'a problem'
      add(a.raisedBy, 'trade_disputed', `You opened a dispute on trade #${id}: ${why}. The admin will rule on it.`, { requestId: id })
      add(otherOf(p, a.raisedBy), 'trade_disputed', `A dispute was opened against you on trade #${id}: ${why}. The admin will rule on it.`, { requestId: id })
      break
    }

    case 'ReturnRequested':
      add(a.buyer, 'return_requested', `The admin ruled the item on trade #${id} was not as described. Send it back to the seller and mark it returned.`, { requestId: id })
      add(a.seller, 'return_requested', `The admin ruled the item on trade #${id} was not as described. Confirm on the Trades page once the buyer's return reaches you.`, { requestId: id })
      break

    case 'ReturnMarked': {
      const p = await lookup.parties(a.requestId)
      add(a.buyer, 'return_marked', `You marked the item for trade #${id} as returned.`, { requestId: id })
      add(otherOf(p, a.buyer), 'return_marked', `The buyer says the item for trade #${id} was sent back. Confirm when it arrives.`, { requestId: id })
      break
    }

    case 'DisputeResolved': {
      const ruling = Number(a.ruling)
      add(a.winner, 'dispute_resolved', `The admin ruled in your favour on trade #${id}.`, { requestId: id })
      let loserText
      if (ruling === RULING.CLAIMANT_LYING) {
        loserText = `The admin found your dispute on trade #${id} unfounded. You got your stake back, without a bonus.`
      } else if (ruling === RULING.SELLER_WINS) {
        loserText = `The admin ruled for the seller on trade #${id}. You got your stake back, without a bonus.`
      } else if (a.burned > 0n) {
        loserText = `The admin ruled against you on trade #${id}. ${btk(a.burned)} BTK of your stake was burned.`
      } else {
        loserText = `The admin ruled against you on trade #${id}.`
      }
      add(a.loser, 'dispute_resolved', loserText, { requestId: id })
      break
    }

    default:
      break
  }
  return rows
}

// POST /api/activity/sync  { txHash }
//
// Reads a MINED transaction from the chain and records the BarterAgreement
// events in it as activity rows. Nothing in the request is trusted except the
// hash: the rows come from the transaction's logs, only logs emitted by the real
// BarterAgreement address are used, and re-syncing the same transaction is a
// no-op (unique index on tx + log + user). Failed transactions emit no logs.
export const syncActivity = asyncHandler(async (req, res) => {
  const txHash = String(req.body.txHash).toLowerCase()

  try {
    const { provider, agreement, iface, address } = getChain()
    const receipt = await provider.getTransactionReceipt(txHash)
    if (!receipt) throw new ApiError(404, 'That transaction was not found (or is not mined yet).')
    if (receipt.status !== 1) throw new ApiError(400, 'That transaction failed on-chain, so there is nothing to record.')

    // Per-request memo so one tx with several events doesn't re-read the same data.
    const partiesCache = new Map()
    const lookup = {
      async parties(requestId) {
        const key = requestId.toString()
        if (!partiesCache.has(key)) {
          const [req] = await agreement.getRequestsBatch([requestId])
          const [listing] = await agreement.getListingsBatch([req.listingId])
          partiesCache.set(key, {
            owner: listing.owner,
            requester: req.requester,
            title: listing.itemName,
            listingType: LISTING_TYPE_NAMES[Number(listing.listingType)],
          })
        }
        return partiesCache.get(key)
      },
    }

    const ops = []
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== address.toLowerCase()) continue
      let parsed
      try {
        parsed = iface.parseLog(log)
      } catch {
        continue
      }
      if (!parsed) continue
      const rows = await activityFromLog(parsed, lookup)
      for (const row of rows) {
        ops.push({
          updateOne: {
            filter: { txHash, logIndex: log.index, user: row.user },
            update: { $setOnInsert: { ...row, txHash, logIndex: log.index } },
            upsert: true,
          },
        })
      }
    }

    if (ops.length > 0) await Activity.bulkWrite(ops, { ordered: false })
    res.json({ synced: ops.length })
  } catch (err) {
    throw asChainError(err)
  }
})
