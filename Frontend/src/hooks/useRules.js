// src/hooks/useRules.js
import { useBarter } from './useBarter.jsx'
import { useAsyncData } from './useAsyncData'

// Used only until the contract has answered (or if the node is down).
export const DEFAULT_RULES = {
  bonusPercent: 5,
  maxStars: 5,
  ratingWindowSeconds: 3 * 24 * 3600,
  minimumLockBtk: '1.0',
  minimumLockWei: 10n ** 18n,
  missingPenaltyPercent: 30,
  notAsDescribedPenaltyPercent: 15,
}

/** The live platform rules, read from BarterAgreement so the UI never disagrees with the contract. */
export function useRules() {
  const { service } = useBarter()
  const { data, loading } = useAsyncData(
    async () => (service ? service.fetchRules() : DEFAULT_RULES),
    [service]
  )
  return { rules: data ?? DEFAULT_RULES, loading, isLive: !!service && !!data && data !== DEFAULT_RULES }
}
