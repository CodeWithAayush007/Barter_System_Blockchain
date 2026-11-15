import { Coins } from 'lucide-react'
import { useBarter } from '../hooks/useBarter.jsx'
import { useTokenBalance } from '../hooks/useTokenBalance'
import { useAdmin } from '../hooks/useAdmin'
import { useChainAction } from '../hooks/useChainAction'
import LoadingSpinner from './LoadingSpinner'

/**
 * Every trade needs the BTK stake of both sides, and a brand-new wallet has
 * none — so offer the one-time 100 BTK starter grant right where people land.
 * Only shows for a connected wallet that hasn't claimed it yet.
 */
export default function StarterTokensBanner() {
  const { canWrite } = useBarter()
  const { loaded, hasClaimedStarter } = useTokenBalance()
  const { isAdmin } = useAdmin()
  const { perform, isPending, step } = useChainAction()

  // The admin does not trade, so it has no use for BTK.
  if (!canWrite || isAdmin || !loaded || hasClaimedStarter) return null

  const claim = () =>
    perform((service, onStep) => service.claimStarterTokens({ onStep }), {
      success: { title: 'BTK claimed', message: 'Your starter BTK is in your wallet.' },
      failureTitle: 'Could not claim BTK',
    })

  return (
    <div className="mx-5 sm:mx-8 mt-6 rounded-xl border border-copper/30 bg-copper/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-start gap-3">
        <Coins size={18} className="text-copper mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-parchment">Claim your starter BTK</p>
          <p className="text-xs text-parchment-muted">
            Every trade locks a BTK stake from both sides. Claim your free one-time grant to get started.
          </p>
        </div>
      </div>
      <button onClick={claim} disabled={isPending} className="btn-primary !py-2 text-sm">
        {isPending ? <LoadingSpinner size={15} label={step || 'Claiming…'} /> : 'Claim 100 BTK'}
      </button>
    </div>
  )
}
