// src/hooks/useAsyncData.js
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseError } from '../utils/errors'

/**
 * Runs an async fetcher, tracking loading/error state safely (ignores
 * results from a stale/unmounted call).
 *
 *  - `deps`        re-run (with a loading state) whenever these change.
 *  - `refreshKey`  re-run *quietly* whenever this changes: the previous data
 *                  stays on screen and no spinner flashes. The chain hooks use
 *                  it to pick up new blocks / finished transactions.
 *  - `fallback`    optional value to show if the fetcher throws.
 *
 * `refetch()` re-runs the fetcher with a loading state; `refetch({ silent: true })`
 * does it quietly.
 */
export function useAsyncData(fetcher, deps = [], { fallback, refreshKey } = {}) {
  const [data, setData] = useState(fallback ?? null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isFallback, setIsFallback] = useState(false)
  const requestId = useRef(0)
  const hasData = useRef(false)
  const lastRefreshKey = useRef(refreshKey)

  const run = useCallback(async ({ silent = false } = {}) => {
    const id = ++requestId.current
    if (!silent) setLoading(true)
    try {
      const result = await fetcher()
      if (id !== requestId.current) return
      setData(result)
      hasData.current = true
      setError(null)
      setIsFallback(false)
    } catch (err) {
      if (id !== requestId.current) return
      if (silent && hasData.current) {
        // A quiet refresh failed — keep showing what we have rather than
        // replacing it with an error.
        return
      }
      setError(parseError(err))
      if (fallback !== undefined) {
        setData(fallback)
        setIsFallback(true)
      }
    } finally {
      if (id === requestId.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    hasData.current = false
    run()
  }, [run])

  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return
    lastRefreshKey.current = refreshKey
    run({ silent: true })
  }, [refreshKey, run])

  const refetch = useCallback((opts) => run(opts), [run])

  return { data, loading, error, isFallback, refetch }
}
