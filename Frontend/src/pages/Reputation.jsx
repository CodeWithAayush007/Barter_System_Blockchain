import { Link, useSearchParams } from 'react-router-dom'
import { Award, Lock, EyeOff, ShieldAlert, Gavel, Wallet as WalletIcon } from 'lucide-react'
import ReputationBadge from '../components/ReputationBadge'
import LoadingSpinner from '../components/LoadingSpinner'
import ChainUnavailable from '../components/ChainUnavailable'
import { useReputation } from '../hooks/useReputation'
import { useAdmin } from '../hooks/useAdmin'
import { useBarter } from '../hooks/useBarter.jsx'
import { useWallet } from '../hooks/useWallet.jsx'
import { formatRating, formatBtk } from '../utils/format'
import { isValidAddress } from '../utils/validation'
import { shortenAddress } from '../blockchain/provider'

export default function Reputation() {
  const [params] = useSearchParams()
  const requested = params.get('address')
  const viewing = requested && isValidAddress(requested) ? requested : null

  const { address: me } = useBarter()
  const { connect } = useWallet()
  const rep = useReputation(viewing)
  const { adminAddress } = useAdmin()
  const { chainStatus } = useBarter()
  const chainDown = ['undeployed', 'unreachable', 'no-contract'].includes(chainStatus.state)

  const isOwn = !viewing || (me && viewing.toLowerCase() === me.toLowerCase())
  // The admin is a referee, not a trader: it never trades, so it has no reputation to show.
  const isAdminRecord = !!adminAddress && !!rep.address && rep.address.toLowerCase() === adminAddress.toLowerCase()

  if (!rep.address) {
    return (
      <div className="max-w-md mx-auto py-24 text-center px-5">
        <span className="grid place-items-center h-14 w-14 rounded-2xl bg-copper/10 border border-copper/25 mx-auto mb-5">
          <WalletIcon size={24} className="text-copper" />
        </span>
        <h1 className="font-display font-semibold text-2xl text-parchment mb-2">Connect your wallet</h1>
        <p className="text-parchment-muted text-sm mb-6">Your reputation is recorded on-chain against your wallet address.</p>
        <button onClick={connect} className="btn-primary mx-auto">Connect Wallet</button>
      </div>
    )
  }

  if (isAdminRecord) {
    return (
      <div className="max-w-lg mx-auto py-24 px-5 text-center" data-testid="admin-no-reputation">
        <span className="grid place-items-center h-14 w-14 rounded-2xl bg-copper/10 border border-copper/25 mx-auto mb-5">
          <Gavel size={24} className="text-copper" />
        </span>
        <h1 className="font-display font-semibold text-2xl text-parchment mb-2">The admin has no reputation</h1>
        <p className="text-parchment-muted text-sm mb-6">
          The platform admin only rules on disputes. It cannot trade, so there are no ratings, trades or bonuses to show.
        </p>
        <Link to={isOwn ? '/admin' : '/marketplace'} className="btn-primary mx-auto">
          {isOwn ? 'Go to the Admin page' : 'Back to the marketplace'}
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10 space-y-8">
      <div>
        <p className="label mb-1">Reputation</p>
        <h1 className="font-display font-semibold text-2xl text-parchment">
          {isOwn ? 'Your on-chain trust record' : <>Trust record of <span className="font-mono">{shortenAddress(rep.address, 6)}</span></>}
        </h1>
        <p className="text-xs text-parchment-faint mt-1">
          Read from the Reputation contract. Only completed on-chain trades can change it — not the backend, not an admin.
          {!isOwn && <> <Link to="/reputation" className="text-copper hover:text-copper-400">View your own</Link></>}
        </p>
      </div>

      <ChainUnavailable />

      {!chainDown && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {isOwn ? (
              <div className="card p-6" data-testid="ratings-private">
                <span className="label flex items-center gap-1.5"><EyeOff size={12} /> Your ratings</span>
                <p className="font-display text-lg font-semibold text-parchment mt-2">Private to you</p>
                <p className="text-xs text-parchment-muted mt-1">
                  What other traders rate you is never shown to you. Other traders can see an average when they decide whether to trade
                  with you.
                </p>
              </div>
            ) : (
              <div className="card p-6 flex items-center gap-4">
                {rep.loading ? (
                  <LoadingSpinner label="Reading chain…" />
                ) : (
                  <>
                    <ReputationBadge averageRating={rep.averageRating} ratingCount={rep.ratingCount} size={64} showLabel={false} />
                    <div>
                      <p className="font-display text-xl font-semibold text-parchment">
                        {rep.ratingCount > 0 ? `${formatRating(rep.averageRating)} average` : 'No ratings yet'}
                      </p>
                      <p className="text-xs text-parchment-muted">{rep.ratingCount} rating{rep.ratingCount === 1 ? '' : 's'} received</p>
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="card p-6">
              <span className="label">Completed Trades</span>
              <p className="font-display text-3xl font-semibold text-parchment mt-2">{rep.completedTrades}</p>
              {rep.firstTradeAt > 0 && <p className="text-xs text-parchment-muted mt-1">since {new Date(rep.firstTradeAt * 1000).toLocaleDateString()}</p>}
            </div>
            <div className="card p-6">
              <span className="label flex items-center gap-1.5"><ShieldAlert size={12} /> Disputes</span>
              <p className="font-display text-3xl font-semibold text-parchment mt-2">
                {rep.disputesRaised} <span className="text-sm text-parchment-muted font-body">raised</span>
              </p>
              <p className="text-xs text-parchment-muted mt-1">
                {rep.disputesWon} won · {rep.disputesLost} lost
                {rep.tokensSlashedWei > 0n && <> · <span className="text-signal-danger">{formatBtk(rep.tokensSlashedWei)} burned</span></>}
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-display font-semibold text-lg text-parchment mb-1 flex items-center gap-2">
              <Award size={18} className="text-copper" />
              Trust Badges
            </h2>
            <p className="text-xs text-parchment-faint mb-4">Worked out from the numbers above — nothing extra is stored.</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {rep.badges.map((b) => (
                <div key={b.id} className={`card p-4 flex flex-col items-center text-center gap-2 ${b.earned ? '' : 'opacity-40'}`}>
                  <span className={`grid place-items-center h-11 w-11 rounded-xl border ${b.earned ? 'bg-copper/10 border-copper/30' : 'bg-white/[0.03] border-ink-border'}`}>
                    {b.earned ? <Award size={18} className="text-copper" /> : <Lock size={16} className="text-parchment-faint" />}
                  </span>
                  <span className="text-xs font-medium text-parchment-muted">{b.label}</span>
                  <span className="text-[11px] text-parchment-faint">{b.rule}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
