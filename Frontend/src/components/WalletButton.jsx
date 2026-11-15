import { useState } from 'react'
import { Wallet, ChevronDown, LogOut, Copy, Check, AlertTriangle, KeyRound, ShieldCheck } from 'lucide-react'
import { useWallet } from '../hooks/useWallet.jsx'
import { useAuth } from '../hooks/useAuth.jsx'
import { shortenAddress } from '../blockchain/provider'
import LoadingSpinner from './LoadingSpinner'

export default function WalletButton() {
  const {
    isConnected, address, connect, disconnect, connecting,
    isWrongNetwork, switchNetwork, switchingNetwork, error, clearError,
  } = useWallet()
  const { isAuthenticated, signIn, signOut, signingIn } = useAuth()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!isConnected) {
    return (
      <div className="relative">
        <button onClick={connect} disabled={connecting} className="btn-primary">
          {connecting ? <LoadingSpinner size={16} label="Connecting…" /> : (
            <>
              <Wallet size={16} />
              Connect Wallet
            </>
          )}
        </button>
        {error && (
          <div
            onClick={clearError}
            className="absolute right-0 mt-2 w-64 rounded-lg bg-signal-danger/10 border border-signal-danger/30 text-signal-danger text-xs px-3 py-2 z-50 cursor-pointer"
            title="Click to dismiss"
          >
            {error}
          </div>
        )}
      </div>
    )
  }

  if (isWrongNetwork) {
    return (
      <div className="relative">
        <button
          onClick={() => switchNetwork()}
          disabled={switchingNetwork}
          className="inline-flex items-center gap-2 rounded-xl bg-signal-danger/15 border border-signal-danger/40 text-signal-danger font-medium px-4 py-2.5 transition-colors hover:bg-signal-danger/25 disabled:opacity-60"
        >
          <AlertTriangle size={16} />
          {switchingNetwork ? <LoadingSpinner size={15} label="Switching…" /> : 'Wrong Network — Switch'}
        </button>
        {error && (
          <div
            onClick={clearError}
            className="absolute right-0 mt-2 w-64 rounded-lg bg-signal-danger/10 border border-signal-danger/30 text-signal-danger text-xs px-3 py-2 z-50 cursor-pointer"
            title="Click to dismiss"
          >
            {error}
          </div>
        )}
      </div>
    )
  }

  const copyAddress = () => {
    navigator.clipboard?.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-secondary"
      >
        <span className="h-2 w-2 rounded-full bg-ledger animate-pulseRing" />
        <span className="font-mono text-sm">{shortenAddress(address)}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 card p-2 z-50 animate-fadeUp">
          <div className="px-3 py-2 flex items-center gap-2 text-xs">
            {isAuthenticated ? (
              <span className="flex items-center gap-1.5 text-ledger"><ShieldCheck size={13} /> Signed in to Trove</span>
            ) : (
              <button
                onClick={signIn}
                disabled={signingIn}
                className="flex items-center gap-1.5 text-copper hover:text-copper-400"
              >
                <KeyRound size={13} />
                {signingIn ? 'Signing…' : 'Sign in to Trove'}
              </button>
            )}
          </div>
          <button
            onClick={copyAddress}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-parchment-muted hover:bg-white/[0.04] hover:text-parchment transition-colors"
          >
            {copied ? <Check size={15} className="text-ledger" /> : <Copy size={15} />}
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <button
            onClick={() => { signOut(); disconnect(); setOpen(false) }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-signal-danger hover:bg-signal-danger/10 transition-colors"
          >
            <LogOut size={15} />
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
