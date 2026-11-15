import { AlertTriangle, ServerCrash } from 'lucide-react'
import { useWallet } from '../hooks/useWallet.jsx'
import { useBarter } from '../hooks/useBarter.jsx'

/**
 * Two kinds of "you can't trade right now" banners:
 *  1. the wallet is on a network the app doesn't support;
 *  2. the app can't talk to the contracts at all (node not running, or the
 *     contracts aren't deployed at the configured addresses).
 */
export default function NetworkWarning() {
  const { isConnected, isWrongNetwork, switchNetwork, switchingNetwork, network } = useWallet()
  const { chainStatus } = useBarter()
  const chainDown = ['undeployed', 'unreachable', 'no-contract'].includes(chainStatus.state)

  return (
    <>
      {isConnected && isWrongNetwork && (
        <div className="bg-signal-danger/10 border-b border-signal-danger/30 px-5 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-signal-danger">
              <AlertTriangle size={16} />
              Your wallet is on {network?.name ?? 'another network'}, but the contracts are on Hardhat Localhost. Switch to continue trading.
            </div>
            <button
              onClick={() => switchNetwork()}
              disabled={switchingNetwork}
              className="text-sm font-medium text-signal-danger underline underline-offset-2 hover:text-signal-danger/80 disabled:opacity-60"
            >
              {switchingNetwork ? 'Switching…' : 'Switch network'}
            </button>
          </div>
        </div>
      )}
      {chainDown && (
        <div className="bg-signal-warn/10 border-b border-signal-warn/30 px-5 py-2.5">
          <div className="max-w-7xl mx-auto flex items-start gap-2 text-sm text-signal-warn">
            <ServerCrash size={16} className="mt-0.5 shrink-0" />
            <span>
              {chainStatus.message}{' '}
              {chainStatus.state === 'unreachable' && (
                <span className="text-signal-warn/80">
                  Start it with <span className="font-mono">npm run dev</span> in the project folder.
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </>
  )
}
