import { Bell, Wallet as WalletIcon, ArrowRight, Info, CheckCircle2, AlertTriangle, BellRing } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useWallet } from '../hooks/useWallet.jsx'
import { shortenAddress } from '../blockchain/provider'
import TokenBalanceCard from '../components/TokenBalanceCard'
import TradeCard from '../components/TradeCard'
import LoadingSpinner from '../components/LoadingSpinner'
import ChainUnavailable from '../components/ChainUnavailable'
import { useTrades } from '../hooks/useTrades'
import { useActivity } from '../hooks/useActivity'
import { useReputation } from '../hooks/useReputation'
import { useTokenBalance } from '../hooks/useTokenBalance'
import { useBarter } from '../hooks/useBarter.jsx'
import { tradeHint } from '../utils/trades'
import { formatBtk, tradeStatusLabel } from '../utils/format'

const NOTIF_ICON = { info: Info, success: CheckCircle2, warn: AlertTriangle }
const OPEN_STATUSES = ['pending', 'in_escrow', 'awaiting_ratings', 'disputed', 'return_pending']

export default function Dashboard() {
  const { isConnected, address, connect } = useWallet()
  const { chainStatus } = useBarter()
  const navigate = useNavigate()

  const { trades, locked, loading: tradesLoading } = useTrades()
  const { notifications, loading: notifLoading, error: notifError } = useActivity(address)
  const { completedTrades, disputesRaised, disputesWon, disputesLost, loading: repLoading } = useReputation()
  const { balance, loading: balanceLoading } = useTokenBalance()

  const chainDown = ['undeployed', 'unreachable', 'no-contract'].includes(chainStatus.state)
  const activeTrades = trades.filter((t) => OPEN_STATUSES.includes(t.status))
  const attention = trades.filter((t) => t.needsAction)

  if (!isConnected) {
    return (
      <div className="max-w-md mx-auto py-24 text-center px-5">
        <span className="grid place-items-center h-14 w-14 rounded-2xl bg-copper/10 border border-copper/25 mx-auto mb-5">
          <WalletIcon size={24} className="text-copper" />
        </span>
        <h1 className="font-display font-semibold text-2xl text-parchment mb-2">Connect your wallet</h1>
        <p className="text-parchment-muted text-sm mb-6">
          Your dashboard shows your BTK balance, trades and dispute record — all tied to your connected wallet.
        </p>
        <button onClick={connect} className="btn-primary mx-auto">Connect Wallet</button>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-5 sm:px-8 py-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="label mb-1">Wallet</p>
          <h1 className="font-display font-semibold text-2xl text-parchment font-mono">{shortenAddress(address, 6)}</h1>
        </div>
        <button onClick={() => navigate('/create')} className="btn-primary">
          New Listing <ArrowRight size={16} />
        </button>
      </div>

      <ChainUnavailable />

      {!chainDown && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <TokenBalanceCard
              balance={balance}
              lockedBtkWei={locked.btkWei}
              lockedEthWei={locked.ethWei}
              loading={balanceLoading}
            />

            <div className="card p-5">
              <span className="label">Disputes</span>
              <p className="font-display text-3xl font-semibold text-parchment mt-3">
                {repLoading ? <LoadingSpinner size={20} /> : disputesRaised}{' '}
                <span className="text-sm text-parchment-muted font-body">raised</span>
              </p>
              <p className="text-xs text-parchment-muted mt-3">{disputesWon} won · {disputesLost} lost</p>
            </div>

            <div className="card p-5">
              <span className="label">Active Trades</span>
              <p className="font-display text-3xl font-semibold text-parchment mt-3">
                {tradesLoading ? <LoadingSpinner size={20} /> : activeTrades.length}
              </p>
              <p className="text-xs text-parchment-muted mt-3">
                {attention.length > 0 ? (
                  <span className="text-copper">{attention.length} need{attention.length === 1 ? 's' : ''} your action</span>
                ) : (
                  'Nothing waiting on you'
                )}
              </p>
            </div>

            <div className="card p-5">
              <span className="label">Completed Trades</span>
              <p className="font-display text-3xl font-semibold text-parchment mt-3">
                {repLoading ? <LoadingSpinner size={20} /> : completedTrades}
              </p>
              <p className="text-xs text-parchment-muted mt-3">
                Ratings you receive stay private
              </p>
            </div>
          </div>

          {attention.length > 0 && (
            <div className="card border-copper/40 p-5">
              <h2 className="font-display font-semibold text-parchment flex items-center gap-2 mb-3">
                <BellRing size={17} className="text-copper" /> Waiting on you
              </h2>
              <ul className="divide-y divide-ink-border">
                {attention.map((t) => (
                  <li key={t.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-parchment truncate">
                        #{t.id} · {t.listingTitle} <span className="text-parchment-faint">({tradeStatusLabel(t.status)})</span>
                      </p>
                      <p className="text-xs text-parchment-muted">{tradeHint(t)}</p>
                    </div>
                    <Link to="/trades" className="text-sm text-copper hover:text-copper-400 shrink-0">Open</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold text-lg text-parchment">Active Trades</h2>
                <button onClick={() => navigate('/trades')} className="text-sm text-copper hover:text-copper-400">
                  View all
                </button>
              </div>
              <div className="space-y-4">
                {tradesLoading ? (
                  <div className="py-10 flex justify-center"><LoadingSpinner label="Reading trades…" /></div>
                ) : activeTrades.length === 0 ? (
                  <p className="text-sm text-parchment-muted">
                    No active trades right now. Locked in escrow: {formatBtk(locked.btkWei)}.
                  </p>
                ) : (
                  activeTrades.slice(0, 3).map((trade) => <TradeCard key={trade.id} trade={trade} compact readOnly />)
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-4">
                <Bell size={17} className="text-parchment-muted" />
                <h2 className="font-display font-semibold text-lg text-parchment">Recent activity</h2>
              </div>
              <div className="card divide-y divide-ink-border">
                {notifLoading ? (
                  <div className="p-4"><LoadingSpinner label="Loading…" /></div>
                ) : notifications.length === 0 ? (
                  <p className="text-sm text-parchment-muted p-4">
                    {notifError
                      ? 'The activity feed is offline (the backend isn\'t running). Your trades above still come straight from the chain.'
                      : 'No recorded activity yet.'}
                  </p>
                ) : (
                  notifications.map((n) => {
                    const Icon = NOTIF_ICON[n.type] || Info
                    const color = n.type === 'success' ? 'text-ledger' : n.type === 'warn' ? 'text-signal-warn' : 'text-copper'
                    return (
                      <div key={n.id} className="flex items-start gap-3 p-4">
                        <Icon size={16} className={`${color} mt-0.5 shrink-0`} />
                        <div>
                          <p className="text-sm text-parchment">{n.message}</p>
                          <p className="text-xs text-parchment-faint mt-0.5">{n.ago}</p>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
