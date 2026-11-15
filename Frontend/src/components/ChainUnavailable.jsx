import { useEffect, useState } from 'react'
import { ServerCrash, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'
import { useBarter } from '../hooks/useBarter.jsx'

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')

function Row({ label, ok, children }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ledger" />
      ) : (
        <XCircle size={14} className="mt-0.5 shrink-0 text-signal-danger" />
      )}
      <span>
        <span className="text-parchment">{label}</span> <span className="text-parchment-muted">{children}</span>
      </span>
    </li>
  )
}

/** One line per thing we checked, so "why can't it read the chain?" has a concrete answer. */
function Diagnosis({ info }) {
  const { direct, wallet, address, rpcUrl } = info
  return (
    <div className="mt-6 text-left rounded-lg border border-ink-border bg-ink p-4 text-xs space-y-2">
      <p className="label">What the app checked</p>
      <ul className="space-y-1.5">
        <Row label="Blockchain node" ok={direct.reachable}>
          {direct.reachable
            ? `answers at ${rpcUrl ?? 'its RPC'} (chain ${direct.chainId}, block ${direct.block})`
            : `is not answering at ${rpcUrl ?? 'its RPC'} — it isn't running`}
        </Row>
        {direct.reachable && (
          <Row label={`Contracts at ${short(address)}`} ok={direct.hasContract}>
            {direct.hasContract
              ? 'found'
              : 'NOT found — the chain is running but nothing is deployed on it (it was probably restarted)'}
          </Row>
        )}
        {wallet && (
          <Row label="Your wallet's network" ok={wallet.reachable && wallet.hasContract}>
            {!wallet.reachable
              ? 'is not answering — check the network RPC URL in MetaMask'
              : wallet.hasContract
              ? `sees the contracts (chain ${wallet.chainId}, block ${wallet.block})`
              : `can NOT see the contracts (chain ${wallet.chainId}, block ${wallet.block}) — it points at a different or restarted chain`}
          </Row>
        )}
      </ul>
    </div>
  )
}

/**
 * Shown in place of a page's data when the app can't read the contracts.
 * Returns null when everything is fine, so pages can render it unconditionally.
 */
export default function ChainUnavailable() {
  const { chainStatus, service, refresh } = useBarter()
  const broken = ['undeployed', 'unreachable', 'no-contract'].includes(chainStatus.state)
  const [info, setInfo] = useState(null)

  useEffect(() => {
    let cancelled = false
    setInfo(null)
    if (!broken || !service) return
    service
      .diagnose()
      .then((d) => !cancelled && setInfo(d))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [broken, service, chainStatus.state])

  if (!broken) return null

  return (
    <div className="card p-8 max-w-xl mx-auto text-center my-10">
      <span className="grid place-items-center h-12 w-12 rounded-2xl bg-signal-warn/10 border border-signal-warn/30 mx-auto mb-4">
        <ServerCrash size={22} className="text-signal-warn" />
      </span>
      <h2 className="font-display font-semibold text-xl text-parchment mb-2">Can't read the blockchain</h2>
      <p className="text-sm text-parchment-muted mb-5">{chainStatus.message}</p>

      <ol className="text-left text-sm text-parchment-muted space-y-1.5 list-decimal list-inside">
        <li>
          In the project folder run <span className="font-mono text-parchment">npm run dev</span> — it starts the
          blockchain <em>and</em> deploys the contracts. Keep that terminal open.
        </li>
        <li>Refresh this page (or press the button below).</li>
        <li>
          Using MetaMask? Make sure the <span className="font-mono">Hardhat Localhost</span> network has RPC URL{' '}
          <span className="font-mono text-parchment">http://127.0.0.1:8545</span>, and after any chain restart use{' '}
          <span className="font-mono">Settings → Advanced → Clear activity tab data</span>.
        </li>
      </ol>

      <button onClick={refresh} className="btn-secondary mt-5 inline-flex items-center gap-2 !px-4 !py-2 text-sm">
        <RefreshCw size={14} /> Check again
      </button>

      {info && <Diagnosis info={info} />}
    </div>
  )
}
