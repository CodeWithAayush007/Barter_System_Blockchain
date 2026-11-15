import { Coins, Lock } from 'lucide-react'
import { formatBtk, formatEth } from '../utils/format'

/**
 * `balance` is BTK in the wallet right now. `lockedBtkWei` / `lockedEthWei`
 * is what this wallet currently has sitting in escrow across its trades.
 */
export default function TokenBalanceCard({ balance, lockedBtkWei = 0n, lockedEthWei = 0n, loading = false }) {
  return (
    <div className="card p-5 relative overflow-hidden">
      <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-copper/10 blur-2xl" />
      <div className="flex items-center justify-between relative">
        <span className="label">BTK Balance</span>
        <span className="grid place-items-center h-8 w-8 rounded-lg bg-copper/10 border border-copper/25">
          <Coins size={15} className="text-copper" />
        </span>
      </div>
      <p className="font-display text-3xl font-semibold text-parchment mt-3 relative">
        {loading ? '…' : Number(balance).toLocaleString(undefined, { maximumFractionDigits: 3 })}{' '}
        <span className="text-lg text-parchment-muted font-body">BTK</span>
      </p>
      <div className="flex items-center gap-1.5 mt-3 text-xs text-parchment-muted relative">
        <Lock size={12} className="text-ledger shrink-0" />
        <span>
          {formatBtk(lockedBtkWei)}
          {lockedEthWei > 0n && <> + {formatEth(lockedEthWei)}</>} locked in escrow
        </span>
      </div>
    </div>
  )
}
