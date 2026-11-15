// src/hooks/useBarter.jsx
//
// Gives every screen one shared `service` (see blockchain/barterService.js):
//
//   • wallet connected on a supported network → the service is bound to the
//     user's signer, so it can both READ the chain and SEND transactions;
//   • no wallet (or the wrong network)         → it is bound to a plain
//     read-only RPC provider, so the marketplace still shows real on-chain
//     listings, but every write asks the visitor to connect first.
//
// It also owns the "something changed on chain" tick: after a transaction —
// and every few seconds while the tab is visible — it bumps `version`, which
// the data hooks use to quietly re-read the chain.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useWallet } from './useWallet.jsx'
import { createBarterService } from '../blockchain/barterService'
import { getReadProvider } from '../blockchain/provider'
import { DEFAULT_CHAIN_ID, isDeployedOn, NETWORKS } from '../blockchain/networks'
import { parseError } from '../utils/errors'

const BarterContext = createContext(null)

const POLL_MS = 8000

export function BarterProvider({ children }) {
  const { signer, address, chainId, isWrongNetwork } = useWallet()
  const [version, setVersion] = useState(0)
  const [chainStatus, setChainStatus] = useState({ state: 'checking', message: '' })

  // Which chain are we talking to, and can we send transactions on it?
  const writeChainId = address && signer && chainId && !isWrongNetwork ? chainId : null
  const activeChainId = writeChainId ?? DEFAULT_CHAIN_ID
  const deployed = isDeployedOn(activeChainId)

  const service = useMemo(() => {
    if (!deployed) return null
    try {
      // Reads always go straight to the chain's own RPC node. The wallet is only used to sign and
      // send — MetaMask keeps a cached view of a local chain that goes stale when the chain restarts.
      let readProvider = null
      try {
        readProvider = getReadProvider(activeChainId)
      } catch {
        readProvider = null // no RPC URL configured for this network → fall back to the wallet's
      }
      const runner = writeChainId ? signer : readProvider
      if (!runner) return null
      return createBarterService({
        chainId: activeChainId,
        runner,
        account: writeChainId ? address : null,
        readProvider,
      })
    } catch {
      return null
    }
  }, [deployed, writeChainId, activeChainId, signer, address])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  // Only re-render consumers when the status actually changes (the probe runs
  // on every poll).
  const updateStatus = useCallback((next) => {
    setChainStatus((prev) => (prev.state === next.state && prev.message === next.message ? prev : next))
  }, [])

  // Poll for new state while the tab is in view — this is how the second
  // trader sees "your counterparty just locked their stake" without reloading.
  useEffect(() => {
    if (!service) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [service, refresh])

  // Probe the chain so the UI can say *why* nothing loads (node down, or the
  // contracts are not at the configured addresses) instead of showing blanks.
  useEffect(() => {
    let cancelled = false
    if (!deployed) {
      updateStatus({
        state: 'undeployed',
        message: `The contracts are not deployed on ${NETWORKS[activeChainId]?.name ?? activeChainId} yet. Run "npm run dev" in the project folder (it starts the chain and deploys them), then refresh.`,
      })
      return
    }
    if (!service) return
    ;(async () => {
      try {
        await service.probe() // is the node up, and is there really a contract at the expected address?
        if (!cancelled) updateStatus({ state: 'ready', message: '' })
      } catch (err) {
        if (cancelled) return
        const text = parseError(err)
        updateStatus({
          state: err?.chainCode === 'NO_CONTRACT' ? 'no-contract' : 'unreachable',
          message: text,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [service, deployed, activeChainId, version, updateStatus])

  const value = {
    service,
    version,
    refresh,
    // true when the wallet is connected on a supported, deployed network
    canWrite: !!service?.canWrite,
    deployed,
    activeChainId,
    chainName: NETWORKS[activeChainId]?.name ?? activeChainId,
    chainStatus,
    address,
  }

  return <BarterContext.Provider value={value}>{children}</BarterContext.Provider>
}

export function useBarter() {
  const ctx = useContext(BarterContext)
  if (!ctx) throw new Error('useBarter must be used within a BarterProvider')
  return ctx
}
