// src/hooks/useTokenBalance.js
import { useBarter } from './useBarter.jsx'
import { useAsyncData } from './useAsyncData'

/**
 * BTK and ETH balances of the connected wallet, read from BarterToken and the
 * node. Also says whether the one-time 100 BTK starter grant has been claimed.
 */
export function useTokenBalance() {
  const { service, version, address } = useBarter()

  const { data, loading, error, refetch } = useAsyncData(
    async () => {
      if (!service || !address) return null
      return service.fetchBalances(address)
    },
    [service, address],
    { refreshKey: version }
  )

  return {
    balance: data?.btk ?? '0',
    balanceWei: data?.btkWei ?? 0n,
    eth: data?.eth ?? '0',
    hasClaimedStarter: data?.hasClaimedStarter ?? true, // don't flash the banner while loading
    loaded: !!data,
    loading,
    error,
    refetch,
  }
}
