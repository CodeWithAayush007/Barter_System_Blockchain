import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, Wallet as WalletIcon } from 'lucide-react'
import TradeCard from '../components/TradeCard'
import Modal from '../components/Modal'
import StarRating from '../components/StarRating'
import LoadingSpinner from '../components/LoadingSpinner'
import ChainUnavailable from '../components/ChainUnavailable'
import { useBarter } from '../hooks/useBarter.jsx'
import { useWallet } from '../hooks/useWallet.jsx'
import { useAuth } from '../hooks/useAuth.jsx'
import { useToasts } from '../hooks/useToasts.jsx'
import { useTrades } from '../hooks/useTrades'
import { useChainAction } from '../hooks/useChainAction'
import { useRules } from '../hooks/useRules'
import { bonusFor } from '../blockchain/barterService'
import { formatBtk, formatEth, formatDuration, disputeKindLabel } from '../utils/format'
import { TRADE_TABS } from '../utils/trades'
import { hashImageFile } from '../utils/listingMeta'
import { uploadRequestPhoto } from '../utils/requestMeta'
import { imageProblem } from '../utils/images'

const MAX_TEXT = 300

// What each button does on-chain. `x` carries what the dialog collected (stars, note, kind, reason).
const SERVICE_CALL = {
  accept: (s, t, o) => s.acceptTrade(t, o),
  reject: (s, t, o) => s.rejectTrade(t.id, o),
  cancel: (s, t, o) => s.cancelTrade(t.id, o),
  ship: (s, t, o, x) => s.markShipped(t.id, x.note, o),
  confirm: (s, t, o) => s.confirmCompletion(t.id, o),
  dispute: (s, t, o, x) => s.raiseDispute(t.id, x.kind, x.reason, o),
  proposeCancel: (s, t, o) => s.proposeCancel(t.id, o),
  acceptCancel: (s, t, o) => s.acceptCancel(t.id, o),
  declineCancel: (s, t, o) => s.declineCancel(t.id, o),
  withdrawCancel: (s, t, o) => s.declineCancel(t.id, o),
  markReturned: (s, t, o, x) => s.markReturned(t.id, x.note, o),
  confirmReturn: (s, t, o) => s.confirmReturnReceived(t.id, o),
  finalize: (s, t, o) => s.finalizeTrade(t.id, o),
  rate: (s, t, o, x) => s.rateCounterparty(t.id, x.stars, o),
}

const pct = (wei, percent) => (BigInt(wei) * BigInt(percent)) / 100n

/** What the person opening a dispute risks and stands to gain — in numbers, for this trade. */
function DisputeStakes({ trade, kind, rules }) {
  const x = trade.lockAmountWei
  const b5 = bonusFor(x, rules.maxStars)
  const totalEth = trade.myEthWei + trade.theirEthWei
  const Money = ({ children }) => <span className="font-mono text-copper">{children}</span>

  if (trade.listingType === 'barter') {
    return (
      <ul className="space-y-1.5 text-xs list-disc list-inside">
        <li>
          <span className="text-ledger">If the admin finds you right:</span> you get your <Money>{formatBtk(trade.lockAmountBtk)}</Money>{' '}
          back, a 5★ bonus (<Money>{formatBtk(b5)}</Money>) and <strong>all</strong> the ETH in escrow (<Money>{formatEth(totalEth)}</Money>).
          The other side loses their whole stake.
        </li>
        <li>
          <span className="text-signal-danger">If the admin finds you were not telling the truth:</span> you only get your{' '}
          <Money>{formatBtk(trade.lockAmountBtk)}</Money> and <Money>{formatEth(trade.myEthWei)}</Money> back — no bonus. The other side
          gets their stake, their ETH and the 5★ bonus.
        </li>
      </ul>
    )
  }

  if (trade.iAmSeller) {
    return (
      <ul className="space-y-1.5 text-xs list-disc list-inside">
        <li>
          <span className="text-ledger">If the admin agrees the buyer is just not confirming:</span> you get the{' '}
          <Money>{formatEth(totalEth)}</Money> price, your <Money>{formatBtk(trade.lockAmountBtk)}</Money> back and a 5★ bonus (
          <Money>{formatBtk(b5)}</Money>). The buyer only gets their stake back.
        </li>
        <li>
          <span className="text-signal-danger">If the admin rules for the buyer instead</span> (the item never really arrived, or was not as
          described): the buyer gets their ETH and stake back and you lose {rules.missingPenaltyPercent}% of your stake (
          {rules.notAsDescribedPenaltyPercent}% after a return) — burned.
        </li>
      </ul>
    )
  }

  // the buyer
  return (
    <ul className="space-y-1.5 text-xs list-disc list-inside">
      {kind !== 'not_as_described' && (
        <li>
          <span className="text-ledger">Item never arrived — if the admin agrees:</span> you get your <Money>{formatEth(totalEth)}</Money>{' '}
          and <Money>{formatBtk(trade.lockAmountBtk)}</Money> back. The seller gets {100 - rules.missingPenaltyPercent}% of their stake back;{' '}
          {rules.missingPenaltyPercent}% (<Money>{formatBtk(pct(x, rules.missingPenaltyPercent))}</Money>) is burned.
        </li>
      )}
      {kind !== 'not_received' && (
        <li>
          <span className="text-ledger">Not as described — if the admin agrees:</span> you send the item back first. Once it is confirmed
          you get your <Money>{formatEth(totalEth)}</Money>, your <Money>{formatBtk(trade.lockAmountBtk)}</Money> and a 5★ bonus (
          <Money>{formatBtk(b5)}</Money>). The seller gets {100 - rules.notAsDescribedPenaltyPercent}% of their stake back;{' '}
          {rules.notAsDescribedPenaltyPercent}% (<Money>{formatBtk(pct(x, rules.notAsDescribedPenaltyPercent))}</Money>) is burned.
        </li>
      )}
      <li>
        <span className="text-signal-danger">If the admin sides with the seller</span> (your dispute was not true): you only get your{' '}
        <Money>{formatBtk(trade.lockAmountBtk)}</Money> back. The seller gets the <Money>{formatEth(totalEth)}</Money> and a 5★ bonus.
      </li>
    </ul>
  )
}

// Everything the confirmation dialog says, per action. `body` gets the trade (and the dialog's inputs for the ones that need them).
const ACTION_COPY = {
  accept: {
    title: 'Accept this trade?',
    confirmLabel: 'Accept & lock stake',
    success: 'Trade accepted — both sides are now locked in escrow.',
    body: (t) => (
      <>
        <p>
          You'll lock <span className="font-mono text-copper">{formatBtk(t.lockAmountBtk)}</span>
          {t.listingType !== 'sell' && t.listing.priceWei > 0n && (
            <>
              {' '}and <span className="font-mono text-copper">{formatEth(t.listing.priceEth)}</span>{' '}
              {t.listingType === 'buy' ? '(the price you offered)' : '(your ETH stake)'}
            </>
          )}{' '}
          in escrow, matching what the other side already locked. Any other pending requests on this listing are rejected and refunded
          automatically.
        </p>
        <p className="text-xs text-parchment-faint">
          Your wallet may ask twice: first to let the escrow lock the BTK, then to accept.
        </p>
      </>
    ),
  },
  reject: {
    title: 'Reject this request?',
    confirmLabel: 'Reject request',
    danger: true,
    success: "Request rejected — the requester's stake was returned.",
    body: () => <p>Everything they locked goes straight back to them. Nothing is taken from you.</p>,
  },
  cancel: {
    title: 'Cancel your request?',
    confirmLabel: 'Cancel request',
    danger: true,
    success: 'Request cancelled — everything you locked was returned.',
    body: (t) => (
      <p>
        Your locked {formatBtk(t.lockAmountBtk)}
        {t.myEthWei > 0n && <> and {formatEth(t.myEthWei)}</>} are returned to your wallet.
      </p>
    ),
  },
  ship: {
    title: 'Mark the item as shipped?',
    confirmLabel: 'Mark as shipped',
    success: 'Marked as shipped. The buyer can now confirm receipt.',
    needsNote: true,
    noteLabel: 'Tracking number or how you handed it over (optional)',
    body: () => (
      <p>
        Tell the buyer the item is on its way (or was handed over). It also lets <strong>you</strong> open a dispute if they never
        confirm receipt — you cannot do that before the item is marked shipped.
      </p>
    ),
  },
  confirm: {
    title: 'Confirm you have it?',
    confirmLabel: "Yes, it's here",
    success: 'Your confirmation is recorded on-chain.',
    body: (t) =>
      t.listingType === 'barter' ? (
        <>
          <p>
            Only confirm once you've actually received what was agreed. When <em>both</em> of you confirm, each of you gets your ETH
            deposit back straight away and you rate each other (1–5★).
          </p>
          <p className="text-xs text-parchment-faint">Something wrong with the exchange? Don't confirm — open a dispute instead.</p>
        </>
      ) : (
        <>
          <p>
            Confirming tells the escrow you have the item: the seller is paid <span className="font-mono text-copper">{formatEth(t.myEthWei + t.theirEthWei)}</span>{' '}
            right away and you rate each other (1–5★).
          </p>
          <p className="text-xs text-parchment-faint">
            Is it missing or not what was described? Don't confirm — open a dispute instead.
          </p>
        </>
      ),
  },
  dispute: {
    title: 'Open a dispute?',
    confirmLabel: 'Open dispute',
    danger: true,
    success: 'Dispute opened — the admin will rule on it.',
    needsDispute: true,
    body: () => null, // custom body below
  },
  proposeCancel: {
    title: 'Call this trade off?',
    confirmLabel: 'Ask to call it off',
    success: 'Proposal sent. The trade is called off if the other side agrees.',
    body: (t) => (
      <>
        <p>
          This asks <span className="font-mono text-parchment">{t.counterpartyShort}</span> to agree to cancel. If they do, <strong>everything
          that was locked is refunded to both of you</strong> — no bonus and no penalty — and the listing stays open for new requests.
        </p>
        <p className="text-xs text-parchment-faint">
          If they don't answer, nothing changes. If the item is missing or wrong, open a dispute instead.
        </p>
      </>
    ),
  },
  acceptCancel: {
    title: 'Agree to call it off?',
    confirmLabel: 'Agree & refund both',
    success: 'Trade called off — everything locked was refunded.',
    body: (t) => (
      <p>
        You and <span className="font-mono text-parchment">{t.counterpartyShort}</span> each get back everything you locked (
        {formatBtk(t.lockAmountBtk)}
        {t.myEthWei > 0n && <> + {formatEth(t.myEthWei)}</>}). No bonus, no penalty. The listing stays open.
      </p>
    ),
  },
  declineCancel: {
    title: 'Keep the trade going?',
    confirmLabel: 'Keep the trade',
    success: 'Proposal declined — the trade carries on.',
    body: () => <p>The proposal is cleared and the trade continues as before.</p>,
  },
  withdrawCancel: {
    title: 'Withdraw your proposal?',
    confirmLabel: 'Withdraw proposal',
    success: 'Proposal withdrawn — the trade carries on.',
    body: () => <p>The trade continues as before.</p>,
  },
  markReturned: {
    title: 'Mark the item as sent back?',
    confirmLabel: 'I sent it back',
    success: 'Marked as returned. The seller can now confirm it arrived.',
    needsNote: true,
    noteLabel: 'Tracking number or how you returned it (optional)',
    body: () => (
      <p>
        This tells the seller the item is on its way back. The payout is released when the seller confirms it arrived — or when the admin
        closes the case.
      </p>
    ),
  },
  confirmReturn: {
    title: 'Is the item back with you?',
    confirmLabel: "Yes, it's back",
    success: 'Return confirmed — the payout was released.',
    body: (t) => (
      <>
        <p>
          Only confirm once the item is physically with you. This releases the payout: the buyer gets{' '}
          <span className="font-mono text-copper">{formatEth(t.myEthWei + t.theirEthWei)}</span> and their stake plus a 5★ bonus; you get back
          your stake minus the penalty.
        </p>
      </>
    ),
  },
  finalize: {
    title: 'Finalise this trade?',
    confirmLabel: 'Finalise & release stakes',
    success: 'Trade finalised — stakes and bonuses released.',
    body: () => (
      <p>
        The rating window has closed. Anyone who didn't rate counts as a 5★ for the other side. This releases both stakes and mints the
        bonuses.
      </p>
    ),
  },
  rate: {
    title: 'Rate your counterparty',
    confirmLabel: 'Submit rating',
    success: 'Rating submitted on-chain.',
    body: () => null, // custom body below
  },
}

export default function TradeManagement() {
  const [tab, setTab] = useState(null) // null until the user picks one
  const [action, setAction] = useState(null) // { type, trade }
  const [inputs, setInputs] = useState({ stars: 5, note: '', kind: '', reason: '' })

  const { isConnected, connect } = useWallet()
  const { chainStatus, refresh } = useBarter()
  const { trades, loading, error } = useTrades()
  const { perform, isPending, step, reset } = useChainAction()
  const { rules } = useRules()
  const { isAuthenticated, signIn } = useAuth()
  const { push } = useToasts()

  const chainDown = ['undeployed', 'unreachable', 'no-contract'].includes(chainStatus.state)

  const byTab = useMemo(() => {
    const groups = Object.fromEntries(TRADE_TABS.map((t) => [t.key, []]))
    for (const trade of trades) {
      const t = TRADE_TABS.find((x) => x.statuses.includes(trade.status))
      if (t) groups[t.key].push(trade)
    }
    return groups
  }, [trades])

  // Until the user picks a tab, show the first one with something for them to do
  // (then the first non-empty one).
  const autoTab = useMemo(() => {
    const needs = TRADE_TABS.find((t) => byTab[t.key].some((x) => x.needsAction))
    if (needs) return needs.key
    const nonEmpty = TRADE_TABS.find((t) => byTab[t.key].length > 0)
    return nonEmpty ? nonEmpty.key : TRADE_TABS[0].key
  }, [byTab])
  const activeKey = tab ?? autoTab
  const visible = byTab[activeKey] ?? []

  // The trade list is re-read every few seconds; keep the open dialog pointed at the latest copy.
  const liveTrade = action ? trades.find((t) => t.id === action.trade.id) ?? action.trade : null

  const open = (type, trade) => {
    reset()
    setInputs({
      stars: 5,
      note: '',
      // a seller (or a buyer with only one option) has no choice to make
      kind: trade.disputeKinds?.length === 1 ? trade.disputeKinds[0] : '',
      reason: '',
    })
    setAction({ type, trade })
  }

  const copy = action ? ACTION_COPY[action.type] : null
  const disputeReady = !copy?.needsDispute || (inputs.kind && inputs.reason.trim().length >= 5)

  const submit = async () => {
    const { type } = action
    const trade = liveTrade
    const res = await perform((service, onStep) => SERVICE_CALL[type](service, trade, { onStep }, inputs), {
      success: { title: ACTION_COPY[type].title.replace(/\?$/, ''), message: ACTION_COPY[type].success },
      failureTitle: 'Action failed',
    })
    if (res.ok) setAction(null)
  }

  // The requester's photo did not make it to the backend (it was down, or the upload failed) — let them send it again.
  const reuploadPhoto = async (trade, file) => {
    const problem = imageProblem(file)
    if (problem) {
      push({ type: 'error', title: 'Image not accepted', message: problem })
      return
    }
    const hash = await hashImageFile(file)
    if (hash.toLowerCase() !== trade.imageHash.toLowerCase()) {
      push({
        type: 'error',
        title: 'That is a different photo',
        message: 'The fingerprint recorded on-chain with this request belongs to the original photo. Choose that exact file again.',
      })
      return
    }
    if (!isAuthenticated) {
      const { ok, error: signInError } = await signIn()
      if (!ok) {
        push({ type: 'error', title: 'Sign-in needed', message: signInError || 'Sign the message to upload the photo.' })
        return
      }
    }
    const uploadProblem = await uploadRequestPhoto(trade.id, file)
    if (uploadProblem) {
      push({ type: 'error', title: 'Photo upload failed', message: uploadProblem })
      return
    }
    push({ type: 'success', title: 'Photo uploaded', message: 'The owner can now see it next to your request.' })
    refresh()
  }

  if (!isConnected) {
    return (
      <div className="max-w-md mx-auto py-24 text-center px-5">
        <span className="grid place-items-center h-14 w-14 rounded-2xl bg-copper/10 border border-copper/25 mx-auto mb-5">
          <WalletIcon size={24} className="text-copper" />
        </span>
        <h1 className="font-display font-semibold text-2xl text-parchment mb-2">Connect your wallet</h1>
        <p className="text-parchment-muted text-sm mb-6">Your trades live on the blockchain and are tied to your wallet.</p>
        <button onClick={connect} className="btn-primary mx-auto">Connect Wallet</button>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10">
      <p className="label mb-1">Trades</p>
      <h1 className="font-display font-semibold text-2xl text-parchment mb-1">Manage your trades</h1>
      <p className="text-xs text-parchment-faint mb-8">Every status below is read from the contracts — it can't be changed by anything but a transaction.</p>

      <ChainUnavailable />

      {!chainDown && (
        <>
          <div className="flex items-center gap-2 mb-8 border-b border-ink-border overflow-x-auto">
            {TRADE_TABS.map((t) => {
              const count = byTab[t.key].length
              const attention = byTab[t.key].filter((x) => x.needsAction).length
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-1 pb-3 -mb-px text-sm font-medium border-b-2 transition-colors mr-6 whitespace-nowrap flex items-center gap-2 ${
                    activeKey === t.key ? 'border-copper text-parchment' : 'border-transparent text-parchment-muted hover:text-parchment'
                  }`}
                >
                  {t.label}
                  {count > 0 && (
                    <span className={`text-[11px] font-mono rounded-full px-2 py-0.5 ${attention > 0 ? 'bg-copper/20 text-copper' : 'bg-white/[0.06] text-parchment-muted'}`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {error && !loading && <p className="text-signal-danger text-sm mb-4">{error}</p>}

          {activeKey === 'rating' && visible.length > 0 && (
            <p className="text-xs text-parchment-muted mb-4">
              You have {formatDuration(rules.ratingWindowSeconds)} after the exchange is confirmed to rate. Your rating sets the other
              person's bonus ({rules.bonusPercent}% of the stake per star); if someone doesn't rate in time, the other side gets a default 5★.
              You won't see the rating you receive.
            </p>
          )}

          {loading ? (
            <div className="py-16 flex justify-center"><LoadingSpinner label="Reading trades from the chain…" /></div>
          ) : visible.length === 0 ? (
            <div className="text-center py-24">
              <Inbox size={28} className="text-parchment-faint mx-auto mb-3" />
              <p className="text-parchment-muted">Nothing here yet.</p>
              <p className="text-sm text-parchment-faint mt-1">
                {trades.length === 0 ? (
                  <>Find something in the <Link to="/marketplace" className="text-copper hover:text-copper-400">marketplace</Link> or <Link to="/create" className="text-copper hover:text-copper-400">create a listing</Link>.</>
                ) : (
                  'Trades will show up in this tab as they move through the process.'
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {visible.map((trade) => (
                <TradeCard key={trade.id} trade={trade} busy={isPending} onAction={open} onReuploadPhoto={reuploadPhoto} />
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        open={!!action}
        onClose={() => !isPending && setAction(null)}
        title={copy ? copy.title : ''}
        footer={
          <>
            <button onClick={() => setAction(null)} disabled={isPending} className="btn-ghost border border-ink-border">Back</button>
            <button
              onClick={submit}
              disabled={isPending || !disputeReady}
              className={
                copy?.danger
                  ? 'inline-flex items-center gap-2 rounded-xl bg-signal-danger/15 border border-signal-danger/40 text-signal-danger font-medium px-5 py-2.5 hover:bg-signal-danger/25 disabled:opacity-60'
                  : 'btn-primary disabled:opacity-60'
              }
            >
              {isPending ? <LoadingSpinner size={15} label={step || 'Submitting…'} /> : copy ? copy.confirmLabel : ''}
            </button>
          </>
        }
      >
        {action && liveTrade && (
          <div className="space-y-3">
            <p className="text-xs text-parchment-faint">
              Trade #{liveTrade.id} — {liveTrade.listingTitle}
            </p>

            {action.type === 'rate' && (
              <div className="space-y-3">
                <p>How was your experience with <span className="font-mono text-parchment">{liveTrade.counterpartyShort}</span>?</p>
                <StarRating value={inputs.stars} onChange={(stars) => setInputs((i) => ({ ...i, stars }))} size={30} label="Your rating" />
                <p className="text-xs">
                  Your {inputs.stars}★ gives them their {formatBtk(liveTrade.lockAmountBtk)} stake back plus{' '}
                  <span className="text-copper font-mono">{formatBtk(bonusFor(liveTrade.lockAmountWei, inputs.stars))}</span> of newly minted bonus
                  ({rules.bonusPercent}% × {liveTrade.lockAmountBtk} × {inputs.stars}). Rate honestly — your rating is recorded on-chain, but the
                  person you rate is not shown it in the app.
                </p>
              </div>
            )}

            {action.type === 'dispute' && (
              <div className="space-y-3">
                <p>
                  Tell the admin what went wrong. Both sides' stakes stay frozen until they rule — and you can't take it back once you open it.
                </p>
                {liveTrade.disputeKinds.length > 1 ? (
                  <fieldset className="space-y-1.5">
                    <legend className="label mb-1.5">What is the problem?</legend>
                    {liveTrade.disputeKinds.map((k) => (
                      <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="dispute-kind"
                          value={k}
                          checked={inputs.kind === k}
                          onChange={() => setInputs((i) => ({ ...i, kind: k }))}
                          className="accent-copper"
                        />
                        {disputeKindLabel(k, liveTrade.listingType)}
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <p className="text-sm">
                    <span className="label mr-2">Problem</span>
                    <span className="text-parchment">{disputeKindLabel(liveTrade.disputeKinds[0], liveTrade.listingType)}</span>
                  </p>
                )}
                <div>
                  <label className="label block mb-1.5" htmlFor="dispute-reason">What happened? (the admin reads this)</label>
                  <textarea
                    id="dispute-reason"
                    rows={3}
                    maxLength={MAX_TEXT}
                    value={inputs.reason}
                    onChange={(e) => setInputs((i) => ({ ...i, reason: e.target.value }))}
                    placeholder="e.g. Delivered on 12 Oct, tracking says signed for, the buyer has not answered since."
                    className="input-field resize-none"
                  />
                  {inputs.reason.trim().length > 0 && inputs.reason.trim().length < 5 && (
                    <p className="text-signal-danger text-xs mt-1">Add a few more words so the admin can understand.</p>
                  )}
                </div>
                {(inputs.kind || liveTrade.disputeKinds.length === 1) && (
                  <DisputeStakes trade={liveTrade} kind={inputs.kind || liveTrade.disputeKinds[0]} rules={rules} />
                )}
              </div>
            )}

            {action.type !== 'rate' && action.type !== 'dispute' && copy.body(liveTrade)}

            {copy?.needsNote && (
              <div>
                <label className="label block mb-1.5" htmlFor="trade-note">{copy.noteLabel}</label>
                <input
                  id="trade-note"
                  maxLength={MAX_TEXT}
                  value={inputs.note}
                  onChange={(e) => setInputs((i) => ({ ...i, note: e.target.value }))}
                  className="input-field"
                />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
