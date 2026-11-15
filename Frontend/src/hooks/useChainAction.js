// src/hooks/useChainAction.js
import { useCallback, useState } from 'react'
import { useBarter } from './useBarter.jsx'
import { useWallet } from './useWallet.jsx'
import { useTransaction } from './useTransaction'
import { useToasts } from './useToasts.jsx'
import { syncActivity } from './useActivity'

/**
 * What a "do this on-chain" button needs to know before it can fire:
 *  - `canWrite`  the wallet is connected on a supported network with deployed contracts
 *  - `fix()`     connect the wallet / switch network (what the button does when !canWrite)
 *  - `label`     what to call that fix ("Connect wallet", "Switch network")
 */
export function useWriteGate() {
  const { canWrite, deployed } = useBarter()
  const { isConnected, isWrongNetwork, connect, switchNetwork, connecting, switchingNetwork } = useWallet()

  if (canWrite) return { canWrite: true, label: null, fix: null, busy: false }
  if (!isConnected) return { canWrite: false, label: 'Connect wallet', fix: connect, busy: connecting }
  if (isWrongNetwork) return { canWrite: false, label: 'Switch network', fix: () => switchNetwork(), busy: switchingNetwork }
  return { canWrite: false, label: deployed ? 'Wallet not ready' : 'Contracts not deployed', fix: null, busy: false }
}

/**
 * Runs one on-chain action end to end and keeps the UI honest about it:
 *
 *   const { perform, isPending, step } = useChainAction()
 *   await perform((service, onStep) => service.acceptTrade(trade, { onStep }),
 *                 { success: { title: 'Trade accepted' } })
 *
 *  • refuses to start while a previous transaction is still in flight,
 *  • shows the current step ("Approve 100 BTK in your wallet…"),
 *  • on success: re-reads the chain, tells the backend to cache the activity,
 *    and shows a toast;
 *  • on failure: shows the contract's own revert reason in a toast.
 */
export function useChainAction() {
  const { service, refresh } = useBarter()
  const { run, status, error, reset } = useTransaction()
  const { push } = useToasts()
  const [step, setStep] = useState('')

  const perform = useCallback(
    async (action, { success, failureTitle = 'Transaction failed' } = {}) => {
      if (!service?.canWrite) {
        push({ type: 'error', title: 'Wallet not ready', message: 'Connect your wallet on the right network first.' })
        return { ok: false }
      }
      setStep('')
      const res = await run(() => action(service, setStep))
      setStep('')
      if (res.skipped) return { ok: false }
      if (res.ok) {
        refresh()
        syncActivity(res.result?.txHash)
        if (success) push({ type: 'success', title: success.title, message: success.message })
        return { ok: true, result: res.result }
      }
      push({ type: 'error', title: failureTitle, message: res.error })
      return { ok: false, error: res.error }
    },
    [service, run, refresh, push]
  )

  return { perform, status, error, reset, step, isPending: status === 'pending' }
}
