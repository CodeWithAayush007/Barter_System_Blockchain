// src/hooks/useTransaction.js
import { useCallback, useRef, useState } from 'react'
import { parseError } from '../utils/errors'

/**
 * Wraps a write action (contract call or backend mutation) with:
 *  - a status machine: idle → pending → success | error
 *  - a hard guard against double-submission (a second call while one
 *    is already pending is ignored, not queued)
 *  - consistent, human-readable error messages via parseError()
 *
 * const { run, status, error, reset } = useTransaction()
 * <button disabled={status === 'pending'} onClick={() => run(() => escrow.lockDeposit(id))}>
 */
export function useTransaction() {
  const [status, setStatus] = useState('idle') // idle | pending | success | error
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const inFlight = useRef(false)

  const run = useCallback(async (action) => {
    if (inFlight.current) return { skipped: true }
    inFlight.current = true
    setStatus('pending')
    setError(null)
    try {
      const res = await action()
      setResult(res)
      setStatus('success')
      return { ok: true, result: res }
    } catch (err) {
      const message = parseError(err)
      setError(message)
      setStatus('error')
      return { ok: false, error: message }
    } finally {
      inFlight.current = false
    }
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setError(null)
    setResult(null)
  }, [])

  return { run, status, error, result, reset, isPending: status === 'pending' }
}
