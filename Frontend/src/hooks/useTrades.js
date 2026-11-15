// src/hooks/useTrades.js
import { useMemo } from 'react'
import { useBarter } from './useBarter.jsx'
import { useAsyncData } from './useAsyncData'
import { shortenAddress } from '../blockchain/provider'
import { unixAgo } from '../utils/format'
import { needsAction } from '../utils/trades'
import { loadRequestImages } from '../utils/requestMeta'

/**
 * The connected wallet's trades, read from BarterAgreement + Escrow on chain.
 * The status of a trade (pending, in escrow, completed …) is whatever the
 * contract says it is — the backend is never consulted.
 */
export function useTrades() {
  const { service, version, address } = useBarter()

  const { data, loading, error, refetch } = useAsyncData(
    async () => {
      if (!service || !address) return []
      const list = await service.fetchTrades(address)
      // The photo of what the requester offers is on Cloudinary (URL derived from the on-chain hash); a missing one is simply not shown.
      const images = await loadRequestImages(list)
      return list.map((t) => ({ ...t, photoUrl: images.get(t.id) ?? null }))
    },
    [service, address],
    { refreshKey: version }
  )

  const trades = useMemo(
    () =>
      (data ?? []).map((t) => ({
        ...t,
        counterpartyShort: shortenAddress(t.counterparty),
        updatedAgo: unixAgo(t.updatedAt),
        needsAction: needsAction(t),
      })),
    [data]
  )

  // What the wallet currently has sitting in escrow across all its trades.
  const locked = useMemo(() => {
    let btkWei = 0n
    let ethWei = 0n
    for (const t of trades) {
      btkWei += t.lockedBtkWei
      ethWei += t.lockedEthWei
    }
    return { btkWei, ethWei }
  }, [trades])

  return { trades, locked, loading, error, refetch }
}
