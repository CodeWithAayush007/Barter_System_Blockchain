// src/hooks/useActivity.js
import { apiFetch } from '../utils/api'
import { useBarter } from './useBarter.jsx'
import { useAsyncData } from './useAsyncData'
import { timeAgo } from '../utils/format'

const TYPE_MAP = {
  listing_created: 'info',
  trade_requested: 'info',
  trade_accepted: 'info',
  trade_confirmed: 'info',
  trade_completed: 'success',
  trade_rated: 'success',
  trade_rejected: 'warn',
  trade_cancelled: 'warn',
  trade_shipped: 'info',
  trade_cancel_proposed: 'warn',
  trade_cancel_cleared: 'info',
  trade_cancelled_in_escrow: 'warn',
  trade_disputed: 'warn',
  return_requested: 'warn',
  return_marked: 'info',
  dispute_resolved: 'success',
}

function normalize(item) {
  return {
    id: item._id,
    message: item.message,
    type: TYPE_MAP[item.type] || 'info',
    ago: timeAgo(item.createdAt),
    txHash: item.txHash,
  }
}

/**
 * A readable activity feed. These rows are a *cache*: the backend writes one
 * only after reading the matching event out of a mined transaction on the
 * chain, so the feed can lag or be empty, but it can't invent anything. If the
 * backend isn't running, the feed is simply empty.
 */
export function useActivity(address) {
  const { version } = useBarter()
  const { data, loading, error, refetch } = useAsyncData(
    async () => {
      if (!address) return []
      const items = await apiFetch(`/activity/${address}`, { auth: false })
      return items.map(normalize)
    },
    [address],
    { refreshKey: version }
  )

  return { notifications: data ?? [], loading, error, refetch }
}

/** Tells the backend about a mined transaction so it can cache the resulting activity. Best-effort. */
export function syncActivity(txHash) {
  if (!txHash) return
  apiFetch('/activity/sync', { method: 'POST', body: { txHash }, auth: false }).catch(() => {})
}
