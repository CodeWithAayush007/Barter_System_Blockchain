// src/hooks/useRemoteImage.js
import { useEffect, useState } from 'react'

/**
 * Tracks whether a remote <img> actually loaded. A photo's URL is derived from the on-chain
 * hash, so the URL can exist before the file does (the upload failed, is still in flight, or the
 * backend was down). This tells the component to show its placeholder instead of a broken image,
 * and quietly tries again a few times — the photo usually arrives seconds later.
 *
 *   const img = useRemoteImage(url)
 *   img.status   'none' (no url) | 'loading' | 'loaded' | 'failed'
 *   <img src={img.src} onLoad={img.onLoad} onError={img.onError} />
 */
export function useRemoteImage(url, { retryMs = 30_000, maxRetries = 4 } = {}) {
  const [status, setStatus] = useState(url ? 'loading' : 'none')
  const [attempt, setAttempt] = useState(0)

  // A different url is a different picture: start over.
  useEffect(() => {
    setStatus(url ? 'loading' : 'none')
    setAttempt(0)
  }, [url])

  useEffect(() => {
    if (status !== 'failed' || attempt >= maxRetries) return undefined
    const timer = setTimeout(() => {
      setAttempt((a) => a + 1)
      setStatus('loading')
    }, retryMs)
    return () => clearTimeout(timer)
  }, [status, attempt, retryMs, maxRetries])

  // The query string only exists to make the browser ask again after a failure.
  const src = url && attempt > 0 ? `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}` : url

  return {
    src,
    status,
    failed: status === 'failed',
    loading: status === 'loading',
    onLoad: () => setStatus('loaded'),
    onError: () => setStatus('failed'),
  }
}
