import { useState } from 'react'
import { Send, Gift, Lock, ArrowRightLeft, Info, Flame, Coins, Wallet as WalletIcon } from 'lucide-react'
import TokenBalanceCard from '../components/TokenBalanceCard'
import Modal from '../components/Modal'
import LoadingSpinner from '../components/LoadingSpinner'
import ChainUnavailable from '../components/ChainUnavailable'
import { useTokenBalance } from '../hooks/useTokenBalance'
import { useTokenHistory } from '../hooks/useTokenHistory'
import { useReputation } from '../hooks/useReputation'
import { useTrades } from '../hooks/useTrades'
import { useBarter } from '../hooks/useBarter.jsx'
import { useWallet } from '../hooks/useWallet.jsx'
import { useChainAction, useWriteGate } from '../hooks/useChainAction'
import { validateTransferForm, hasErrors, isValidAddress } from '../utils/validation'
import { formatBtk, formatBtkSigned, unixAgo } from '../utils/format'

const TYPE_ICON = { reward: Gift, transfer: Send, escrow: Lock, burn: Flame }
const TYPE_COLOR = { reward: 'text-ledger', transfer: 'text-copper', escrow: 'text-signal-warn', burn: 'text-signal-danger' }

export default function TokenDashboard() {
  const [transferOpen, setTransferOpen] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  const { address, chainStatus } = useBarter()
  const { connect } = useWallet()
  const gate = useWriteGate()
  const { balance, hasClaimedStarter, loaded, loading: balanceLoading } = useTokenBalance()
  const { history, loading: historyLoading } = useTokenHistory()
  const { completedTrades, tokensSlashedWei } = useReputation()
  const { locked } = useTrades()
  const { perform, isPending, step, error, reset } = useChainAction()

  const chainDown = ['undeployed', 'unreachable', 'no-contract'].includes(chainStatus.state)

  const closeModal = () => {
    setTransferOpen(false)
    setRecipient('')
    setAmount('')
    setFieldErrors({})
    reset()
  }

  const submitTransfer = async () => {
    if (!gate.canWrite) {
      await gate.fix?.()
      return
    }
    const errors = validateTransferForm({ recipient, amount }, address)
    if (hasErrors(errors)) {
      setFieldErrors(errors)
      return
    }
    const res = await perform((service, onStep) => service.transferToken(recipient, amount, { onStep }), {
      success: { title: 'Transfer sent', message: `${amount} BTK sent to ${recipient.slice(0, 8)}…` },
      failureTitle: 'Transfer failed',
    })
    if (res.ok) closeModal()
  }

  const claim = () =>
    perform((service, onStep) => service.claimStarterTokens({ onStep }), {
      success: { title: 'BTK claimed', message: 'Your starter BTK is in your wallet.' },
      failureTitle: 'Could not claim BTK',
    })

  if (!address) {
    return (
      <div className="max-w-md mx-auto py-24 text-center px-5">
        <span className="grid place-items-center h-14 w-14 rounded-2xl bg-copper/10 border border-copper/25 mx-auto mb-5">
          <WalletIcon size={24} className="text-copper" />
        </span>
        <h1 className="font-display font-semibold text-2xl text-parchment mb-2">Connect your wallet</h1>
        <p className="text-parchment-muted text-sm mb-6">Your BTK balance lives on-chain, tied to your wallet.</p>
        <button onClick={connect} className="btn-primary mx-auto">Connect Wallet</button>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="label mb-1">Tokens</p>
          <h1 className="font-display font-semibold text-2xl text-parchment">BTK Token Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          {loaded && !hasClaimedStarter && (
            <button onClick={claim} disabled={isPending || !gate.canWrite} className="btn-primary">
              {isPending ? <LoadingSpinner size={15} label={step || 'Claiming…'} /> : <><Coins size={16} /> Claim 100 BTK</>}
            </button>
          )}
          <button onClick={() => setTransferOpen(true)} className={hasClaimedStarter ? 'btn-primary' : 'btn-secondary'}>
            <Send size={16} /> Transfer Tokens
          </button>
        </div>
      </div>

      <ChainUnavailable />

      {!chainDown && (
        <>
          <div className="grid sm:grid-cols-3 gap-4">
            <TokenBalanceCard balance={balance} lockedBtkWei={locked.btkWei} lockedEthWei={locked.ethWei} loading={balanceLoading} />
            <div className="card p-5">
              <span className="label">Completed Trades</span>
              <p className="font-display text-3xl font-semibold text-parchment mt-3">{completedTrades}</p>
              <p className="text-xs text-parchment-muted mt-2">
                Each one returned your stake plus a trade reward
                {tokensSlashedWei > 0n && <> · <span className="text-signal-danger">{formatBtk(tokensSlashedWei)} burned in disputes</span></>}
              </p>
            </div>
            <div className="card p-5 flex flex-col justify-between">
              <div className="flex items-center gap-2">
                <Info size={15} className="text-copper" />
                <span className="label">What is BTK?</span>
              </div>
              <p className="text-xs text-parchment-muted mt-2 leading-relaxed">
                BTK is the stake you lock on every trade. A clean trade returns it plus a bonus (5% of the stake per star you're rated);
                losing a dispute burns part or all of it. You start with a one-time grant of 100 BTK.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-display font-semibold text-lg text-parchment mb-1 flex items-center gap-2">
              <ArrowRightLeft size={17} className="text-parchment-muted" />
              Activity History
            </h2>
            <p className="text-xs text-parchment-faint mb-4">Read from the token's Transfer events — the escrow locks and returns, mints and burns all show up here.</p>
            <div className="card divide-y divide-ink-border">
              {historyLoading ? (
                <div className="p-5"><LoadingSpinner label="Reading transfers…" /></div>
              ) : history.length === 0 ? (
                <p className="p-5 text-sm text-parchment-muted">No BTK movements yet.</p>
              ) : (
                history.map((item) => {
                  const Icon = TYPE_ICON[item.type] || Send
                  const color = TYPE_COLOR[item.type] || 'text-copper'
                  return (
                    <div key={item.id} className="flex items-center justify-between p-4 sm:p-5">
                      <div className="flex items-center gap-3">
                        <span className={`grid place-items-center h-9 w-9 rounded-lg bg-white/[0.03] border border-ink-border ${color}`}>
                          <Icon size={15} />
                        </span>
                        <div>
                          <p className="text-sm text-parchment">{item.label}</p>
                          <p className="text-xs text-parchment-faint">{unixAgo(item.timestamp)}</p>
                        </div>
                      </div>
                      <span className={`font-mono text-sm ${item.incoming ? 'text-ledger' : 'text-parchment-muted'}`}>
                        {formatBtkSigned(item.amountWei, item.incoming)}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}

      <Modal
        open={transferOpen}
        onClose={closeModal}
        title="Transfer BTK"
        footer={
          <>
            <button onClick={closeModal} className="btn-ghost border border-ink-border">Cancel</button>
            <button onClick={submitTransfer} className="btn-primary" disabled={isPending || gate.busy}>
              {isPending ? <LoadingSpinner size={15} label={step || 'Sending…'} /> : !gate.canWrite ? gate.label : 'Send'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label block mb-2">Recipient address</label>
            <input
              value={recipient}
              onChange={(e) => { setRecipient(e.target.value); setFieldErrors((f) => ({ ...f, recipient: undefined })) }}
              placeholder="0x…"
              className={`input-field font-mono ${recipient && !isValidAddress(recipient) ? 'border-signal-danger/50' : ''}`}
            />
            {fieldErrors.recipient && <p className="text-signal-danger text-xs mt-1.5">{fieldErrors.recipient}</p>}
          </div>
          <div>
            <label className="label block mb-2">Amount (BTK)</label>
            <input
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setFieldErrors((f) => ({ ...f, amount: undefined })) }}
              type="number"
              min="0"
              step="any"
              placeholder="0.0"
              className="input-field font-mono"
            />
            {fieldErrors.amount && <p className="text-signal-danger text-xs mt-1.5">{fieldErrors.amount}</p>}
          </div>
          {error && <p className="text-signal-danger text-sm">{error}</p>}
        </div>
      </Modal>
    </div>
  )
}
