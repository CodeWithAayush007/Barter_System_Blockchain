// src/hooks/useTokenHistory.js
import { useBarter } from './useBarter.jsx'
import { useAsyncData } from './useAsyncData'

/** BTK movements of the connected wallet, rebuilt from the token's Transfer events. */
export function useTokenHistory() {
  const { service, version, address } = useBarter()
  const { data, loading, error } = useAsyncData(
    async () => {
      if (!service || !address) return []
      return service.fetchTokenHistory(address)
    },
    [service, address],
    { refreshKey: version }
  )
  return { history: data ?? [], loading, error }
}
