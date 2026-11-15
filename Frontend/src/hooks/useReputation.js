// src/hooks/useReputation.js
import { useMemo } from 'react'
import { useBarter } from './useBarter.jsx'
import { useAsyncData } from './useAsyncData'

/**
 * Achievements are *derived* from the on-chain numbers (nothing is stored for
 * them anywhere), each with the rule that earns it so it is never a mystery.
 *
 * None of them depend on the star ratings a person has received: those are
 * private to the person who gave them (see the Reputation page).
 */
export function deriveBadges(rep) {
  return [
    { id: 'first', label: 'First trade', rule: 'Complete 1 trade', earned: rep.completedTrades >= 1 },
    { id: 'five', label: 'Regular', rule: 'Complete 5 trades', earned: rep.completedTrades >= 5 },
    {
      id: 'clean',
      label: 'Clean record',
      rule: '3+ trades and no disputes lost',
      earned: rep.completedTrades >= 3 && rep.disputesLost === 0,
    },
    {
      id: 'fair',
      label: 'Fair dealer',
      rule: 'Won every dispute you were in (2+ disputes)',
      earned: rep.disputesWon + rep.disputesLost >= 2 && rep.disputesLost === 0,
    },
  ]
}

const EMPTY = {
  completedTrades: 0,
  averageRating: 0,
  ratingCount: 0,
  tokensEarnedWei: 0n,
  firstTradeAt: 0,
  lastTradeAt: 0,
  disputesRaised: 0,
  disputesWon: 0,
  disputesLost: 0,
  tokensSlashedWei: 0n,
}

/**
 * Reads the reputation ledger straight from Reputation.sol. Only
 * BarterAgreement can write to it, so these numbers can't be edited by anyone
 * — including the backend.
 *
 * `targetAddress` defaults to the connected wallet; pass another address to
 * view someone else's record (no wallet needed — it's a public read).
 *
 * Rating privacy: this hook never hands out what OTHERS rated the connected
 * wallet. For your own address `averageRating` / `ratingCount` / `tokensEarnedWei`
 * are zeroed; they are only returned for someone else's address (which is how
 * other traders judge a stranger). The admin has no record at all.
 */
export function useReputation(targetAddress) {
  const { service, version, address: connected } = useBarter()
  const address = targetAddress || connected
  const isOwn = !!address && !!connected && address.toLowerCase() === connected.toLowerCase()

  const { data, loading, error, refetch } = useAsyncData(
    async () => {
      if (!service || !address) return null
      return service.fetchReputation(address)
    },
    [service, address],
    { refreshKey: version }
  )

  const rep = useMemo(() => {
    const raw = data ?? EMPTY
    if (!isOwn) return raw
    return { ...raw, averageRating: 0, ratingCount: 0, tokensEarnedWei: 0n }
  }, [data, isOwn])
  const badges = useMemo(() => deriveBadges(rep), [rep])

  return { ...rep, badges, address, isOwn, loading, error, refetch }
}
