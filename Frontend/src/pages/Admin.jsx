import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Gavel, ShieldAlert, Wallet as WalletIcon, CheckCircle2, Flame, History, Undo2, Truck } from 'lucide-react'
import Modal from '../components/Modal'
import LoadingSpinner from '../components/LoadingSpinner'
import ChainUnavailable from '../components/ChainUnavailable'
import { useAdmin } from '../hooks/useAdmin'
import { useRemoteImage } from '../hooks/useRemoteImage'
import { useBarter } from '../hooks/useBarter.jsx'
import { useWallet } from '../hooks/useWallet.jsx'
import { useChainAction } from '../hooks/useChainAction'
import { useRules } from '../hooks/useRules'
import { bonusFor } from '../blockchain/barterService'
import { shortenAddress } from '../blockchain/provider'
import { formatBtk, formatEth, unixAgo, LISTING_TYPES, disputeKindLabel, rulingLabel } from '../utils/format'

const TABS = [
  { key: 'open', label: 'Needs a ruling' },
  { key: 'returns', label: 'Waiting for a return' },
  { key: 'history', label: 'History' },
]

// The rulings the admin can pick, per listing type.
const RULING_CHOICES = {
  barter: [
    { ruling: 'claimant_right', label: 'Claimant is right', primary: true },
    { ruling: 'claimant_lying', label: 'Claimant is lying' },
  ],
  trade: [
    { ruling: 'seller_wins', label: 'Seller wins', primary: true },
    { ruling: 'buyer_wins_missing', label: 'Buyer wins — item missing' },
    { ruling: 'buyer_wins_not_as_described', label: 'Buyer wins — not as described' },
  ],
}

const short = (a) => shortenAddress(a, 6)

/** Which side of the trade an address is, in words. */
function sideOf(c, address) {
  const a = address?.toLowerCase()
  if (c.listingType === 'barter') return a === c.listing.ownerLower ? 'listing owner' : 'requester'
  if (a === c.buyer?.toLowerCase()) return 'buyer'
  if (a === c.seller?.toLowerCase()) return 'seller'
  return ''
}

/** Plain-English consequences of a ruling, mirroring BarterAgreement.resolveDispute(). */
function describeRuling(c, ruling, rules) {
  const x = c.lockAmountWei
  const b5 = bonusFor(x, rules.maxStars)
  const eth = c.requesterEthWei + c.ownerEthWei
  const pct = (p) => (x * BigInt(p)) / 100n
  const lines = []
  const ok = (text) => lines.push({ tone: 'ok', text })
  const warn = (text) => lines.push({ tone: 'warn', text })
  const bad = (text) => lines.push({ tone: 'bad', text })

  switch (ruling) {
    case 'claimant_right':
      ok(`${short(c.claimant)} (claimant) gets ${formatBtk(x)} back, a 5★ bonus of ${formatBtk(b5)} and ALL the ETH in escrow (${formatEth(eth)}).`)
      bad(`${short(c.respondent)} forfeits their ${formatBtk(x)} — it is burned — and gets no ETH back.`)
      break
    case 'claimant_lying':
      ok(`${short(c.respondent)} gets ${formatBtk(x)} back, a 5★ bonus of ${formatBtk(b5)} and their ETH deposit back.`)
      warn(`${short(c.claimant)} (the false claimant) only gets ${formatBtk(x)} and their ETH deposit back — no bonus, no penalty.`)
      break
    case 'seller_wins':
      ok(`${short(c.seller)} (seller) is paid ${formatEth(eth)} and gets ${formatBtk(x)} back plus a 5★ bonus of ${formatBtk(b5)}.`)
      warn(`${short(c.buyer)} (buyer) only gets ${formatBtk(x)} back — no bonus.`)
      break
    case 'buyer_wins_missing':
      ok(`${short(c.buyer)} (buyer) gets ${formatEth(eth)} and ${formatBtk(x)} back. No bonus.`)
      bad(`${short(c.seller)} (seller) gets ${100 - rules.missingPenaltyPercent}% of their stake back (${formatBtk(x - pct(rules.missingPenaltyPercent))}); ${formatBtk(pct(rules.missingPenaltyPercent))} is burned.`)
      break
    case 'buyer_wins_not_as_described':
      warn('Nothing is paid out yet. The buyer must send the item back first; the case then waits on the "Waiting for a return" tab.')
      ok(`Once it is returned: ${short(c.buyer)} gets ${formatEth(eth)}, ${formatBtk(x)} back and a 5★ bonus of ${formatBtk(b5)}.`)
      bad(`${short(c.seller)} gets ${100 - rules.notAsDescribedPenaltyPercent}% of their stake back (${formatBtk(x - pct(rules.notAsDescribedPenaltyPercent))}); ${formatBtk(pct(rules.notAsDescribedPenaltyPercent))} is burned.`)
      break
    default:
  }
  return lines
}

function describeReturn(c, returned, rules) {
  const x = c.lockAmountWei
  const b5 = bonusFor(x, rules.maxStars)
  const eth = c.requesterEthWei + c.ownerEthWei
  if (returned) {
    return [
      { tone: 'ok', text: `${short(c.buyer)} (buyer) gets ${formatEth(eth)}, ${formatBtk(x)} back and a 5★ bonus of ${formatBtk(b5)}.` },
      {
        tone: 'bad',
        text: `${short(c.seller)} (seller) gets ${100 - rules.notAsDescribedPenaltyPercent}% of their stake back; ${formatBtk((x * BigInt(rules.notAsDescribedPenaltyPercent)) / 100n)} is burned.`,
      },
    ]
  }
  return [
    { tone: 'ok', text: `The item was never returned, so ${short(c.seller)} (seller) is paid ${formatEth(eth)} and gets ${formatBtk(x)} back plus a 5★ bonus of ${formatBtk(b5)}.` },
    { tone: 'warn', text: `${short(c.buyer)} (buyer) only gets ${formatBtk(x)} back — no bonus.` },
  ]
}

function Thumb({ url, label }) {
  // The URL is derived from the on-chain hash; if the file isn't on Cloudinary the thumbnail is simply left out.
  const photo = useRemoteImage(url)
  if (!url || photo.failed) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block shrink-0" title="Open the full photo">
      <img src={photo.src} alt={label} onLoad={photo.onLoad} onError={photo.onError} className="h-20 w-20 object-cover rounded-lg border border-ink-border hover:border-copper/40 transition-colors" />
      <span className="block text-[10px] text-parchment-faint mt-1 text-center">{label}</span>
    </a>
  )
}

function Party({ title, address, side, note }) {
  return (
    <div className="rounded-lg bg-ink border border-ink-border p-3">
      <p className="label mb-1">{title}{side ? ` · ${side}` : ''}</p>
      <Link to={`/reputation?address=${address}`} className="font-mono text-parchment hover:underline">{short(address)}</Link>
      {note && <p className="text-xs text-parchment-muted mt-1">{note}</p>}
    </div>
  )
}

/** One dispute: who raised it, why, what is at stake and (when it is over) what was decided. */
function CaseCard({ c, actions }) {
  const typeMeta = LISTING_TYPES[c.listingType]
  const eth = c.requesterEthWei + c.ownerEthWei
  const closed = c.status === 'resolved'
  const winnerSide = c.winner ? sideOf(c, c.winner) : ''

  return (
    <div className={`card p-5 space-y-4 ${closed ? '' : 'border-signal-danger/30'}`} data-testid={`case-${c.requestId}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-mono text-signal-danger mb-1">
            <ShieldAlert size={13} /> Dispute · Trade #{c.requestId} · {typeMeta?.label}
          </p>
          <h3 className="font-display font-semibold text-parchment">{c.listing.title}</h3>
        </div>
        <span className="text-[11px] text-parchment-faint whitespace-nowrap">
          {closed ? `closed ${unixAgo(c.closedAt || c.resolvedAt)}` : `opened ${unixAgo(c.raisedAt)}`}
        </span>
      </div>

      <div className="flex items-start gap-3">
        <Thumb url={c.listingPhotoUrl} label="Listing photo" />
        <Thumb url={c.requestPhotoUrl} label="Offered item" />
        <div className="min-w-0 text-sm text-parchment-muted space-y-1">
          <p className="text-xs">{c.listing.description}</p>
          {c.listingType === 'barter' && c.listing.seeking && <p className="text-xs">Wanted in exchange: <span className="text-parchment">{c.listing.seeking}</span></p>}
          {c.request.offeredItem && (
            <p className="text-xs">
              Offered: <span className="text-parchment">{c.request.offeredItem}</span>
              {c.request.offeredDescription && <span className="text-parchment-faint"> — {c.request.offeredDescription}</span>}
            </p>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <Party title="Claimant (raised it)" address={c.claimant} side={sideOf(c, c.claimant)} note={disputeKindLabel(c.kind, c.listingType)} />
        <Party title="Other side" address={c.respondent} side={sideOf(c, c.respondent)} />
      </div>

      {c.reason && (
        <p className="rounded-lg bg-ink border border-ink-border px-3.5 py-2.5 text-sm text-parchment-muted">
          <span className="label mr-2">Their account</span>“{c.reason}”
        </p>
      )}

      <p className="text-xs text-parchment-muted">
        Each side locked {formatBtk(c.lockAmountBtk ?? c.request.lockAmountBtk)}.
        {eth > 0n && <> {formatEth(eth)} is also held in escrow{c.status === 'resolved' ? ' (now released)' : ''}.</>}
        {c.listingType !== 'barter' && (
          <span className="inline-flex items-center gap-1 ml-2 text-parchment-faint">
            <Truck size={12} />
            {c.shipped ? `shipped ${unixAgo(c.shippedAt)}${c.shippingNote ? ` — “${c.shippingNote}”` : ''}` : 'never marked as shipped'}
          </span>
        )}
      </p>

      {closed && (
        <div className="rounded-lg border border-ink-border bg-white/[0.02] px-3.5 py-3 text-xs space-y-1" data-testid="case-outcome">
          <p className="text-parchment font-medium flex items-center gap-1.5">
            <Gavel size={13} /> Ruling: {rulingLabel(c.ruling)}
            {c.returnResult === 'confirmed_by_seller' && <span className="text-parchment-faint font-normal">· return confirmed by the seller</span>}
            {c.returnResult === 'confirmed_by_admin' && <span className="text-parchment-faint font-normal">· return confirmed by you</span>}
            {c.returnResult === 'not_returned' && <span className="text-parchment-faint font-normal">· item never returned</span>}
          </p>
          <p className="text-parchment-muted">
            Winner: <span className="font-mono text-parchment">{short(c.winner)}</span>{winnerSide && ` (${winnerSide})`} · Loser:{' '}
            <span className="font-mono text-parchment">{short(c.loser)}</span>
            {c.winnerBonusWei > 0n && <> · bonus paid {formatBtk(c.winnerBonusWei)}</>}
            {c.burnedWei > 0n && <> · burned {formatBtk(c.burnedWei)}</>}
          </p>
        </div>
      )}

      {!closed && c.status === 'return_pending' && (
        <p className="text-xs text-parchment-muted flex items-center gap-1.5">
          <Undo2 size={13} />
          Ruled “not as described” {unixAgo(c.resolvedAt)}.{' '}
          {c.returnedAt > 0 ? `The buyer says it was sent back ${unixAgo(c.returnedAt)}${c.returnNote ? ` — “${c.returnNote}”` : ''}.` : 'The buyer has not marked it as returned yet.'}
        </p>
      )}

      {actions}
    </div>
  )
}

export default function Admin() {
  const [tab, setTab] = useState('open')
  const [pending, setPending] = useState(null) // { kind: 'ruling' | 'return', c, ruling | returned }
  const { isAdmin, adminAddress, disputes, loading } = useAdmin({ withDisputes: true })
  const { address, chainStatus } = useBarter()
  const { connect } = useWallet()
  const { perform, isPending, step, reset } = useChainAction()
  const { rules } = useRules()

  const chainDown = ['undeployed', 'unreachable', 'no-contract'].includes(chainStatus.state)
  const counts = { open: disputes.open.length, returns: disputes.returns.length, history: disputes.history.length }
  const list = disputes[tab]

  const lines = useMemo(() => {
    if (!pending) return []
    return pending.kind === 'ruling'
      ? describeRuling(pending.c, pending.ruling, rules)
      : describeReturn(pending.c, pending.returned, rules)
  }, [pending, rules])

  const submit = async () => {
    const { kind, c } = pending
    const res = await perform(
      (service, onStep) =>
        kind === 'ruling'
          ? service.resolveDispute(c.requestId, pending.ruling, { onStep })
          : service.adminCloseReturn(c.requestId, pending.returned, { onStep }),
      {
        success: { title: kind === 'ruling' ? 'Ruling recorded' : 'Return closed', message: `Trade #${c.requestId} has been ruled on.` },
        failureTitle: 'Could not record the ruling',
      }
    )
    if (res.ok) setPending(null)
  }

  if (!address) {
    return (
      <div className="max-w-md mx-auto py-24 text-center px-5">
        <span className="grid place-items-center h-14 w-14 rounded-2xl bg-copper/10 border border-copper/25 mx-auto mb-5">
          <WalletIcon size={24} className="text-copper" />
        </span>
        <h1 className="font-display font-semibold text-2xl text-parchment mb-2">Connect the admin wallet</h1>
        <button onClick={connect} className="btn-primary mx-auto mt-4">Connect Wallet</button>
      </div>
    )
  }

  const ruleTitle = pending?.kind === 'ruling' ? rulingLabel(pending.ruling) : pending?.returned ? 'Item was returned' : 'Item was never returned'

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10">
      <p className="label mb-1">Admin</p>
      <h1 className="font-display font-semibold text-2xl text-parchment mb-1">Dispute resolution</h1>
      <p className="text-xs text-parchment-faint mb-8">
        Rulings are transactions to the BarterAgreement contract — the contract rejects anyone but its owner. The admin is a referee: it
        cannot list or trade, and has no reputation.
      </p>

      <ChainUnavailable />

      {!chainDown && loading && <div className="py-16 flex justify-center"><LoadingSpinner label="Reading chain…" /></div>}

      {!chainDown && !loading && !isAdmin && (
        <div className="card p-8 text-center max-w-lg mx-auto">
          <Gavel size={26} className="text-parchment-faint mx-auto mb-3" />
          <h2 className="font-display font-semibold text-lg text-parchment mb-2">Admin only</h2>
          <p className="text-sm text-parchment-muted">
            Only the platform admin — the wallet that deployed the contracts
            {adminAddress && <> (<span className="font-mono text-parchment">{shortenAddress(adminAddress, 6)}</span>)</>} — can rule on disputes.
            You're connected as <span className="font-mono text-parchment">{shortenAddress(address, 6)}</span>.
          </p>
        </div>
      )}

      {!chainDown && !loading && isAdmin && (
        <>
          <div className="flex items-center gap-2 mb-8 border-b border-ink-border overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-1 pb-3 -mb-px text-sm font-medium border-b-2 transition-colors mr-6 whitespace-nowrap flex items-center gap-2 ${
                  tab === t.key ? 'border-copper text-parchment' : 'border-transparent text-parchment-muted hover:text-parchment'
                }`}
              >
                {t.key === 'history' && <History size={14} />}
                {t.label}
                {counts[t.key] > 0 && (
                  <span className={`text-[11px] font-mono rounded-full px-2 py-0.5 ${t.key !== 'history' ? 'bg-signal-danger/15 text-signal-danger' : 'bg-white/[0.06] text-parchment-muted'}`}>
                    {counts[t.key]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {list.length === 0 ? (
            <div className="text-center py-24">
              <CheckCircle2 size={28} className="text-ledger mx-auto mb-3" />
              <p className="text-parchment-muted">
                {tab === 'open' && 'No disputes waiting for a ruling.'}
                {tab === 'returns' && 'No returns are pending.'}
                {tab === 'history' && 'No dispute has been closed yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {tab === 'history' && (
                <p className="text-xs text-parchment-muted">Every dispute that has been settled, newest first — read straight from the contract.</p>
              )}
              {list.map((c) => (
                <CaseCard
                  key={c.requestId}
                  c={c}
                  actions={
                    tab === 'open' ? (
                      <div className="space-y-2">
                        <p className="text-xs text-parchment-muted">Decide off-chain (chat, photos, receipts), then record your ruling:</p>
                        <div className="flex flex-wrap gap-2">
                          {RULING_CHOICES[c.listingType === 'barter' ? 'barter' : 'trade'].map((choice) => (
                            <button
                              key={choice.ruling}
                              onClick={() => { reset(); setPending({ kind: 'ruling', c, ruling: choice.ruling }) }}
                              className={`${choice.primary ? 'btn-primary' : 'btn-secondary'} !px-4 !py-2 text-sm`}
                            >
                              {choice.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : tab === 'returns' ? (
                      <div className="space-y-2">
                        <p className="text-xs text-parchment-muted">
                          The seller can confirm the return themselves. If they don't, or the buyer never sends it, close the case:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => { reset(); setPending({ kind: 'return', c, returned: true }) }} className="btn-primary !px-4 !py-2 text-sm">
                            Item was returned
                          </button>
                          <button onClick={() => { reset(); setPending({ kind: 'return', c, returned: false }) }} className="btn-secondary !px-4 !py-2 text-sm">
                            Never returned — pay the seller
                          </button>
                        </div>
                      </div>
                    ) : null
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        open={!!pending}
        onClose={() => !isPending && setPending(null)}
        title={pending ? `${ruleTitle}?` : ''}
        footer={
          <>
            <button onClick={() => setPending(null)} disabled={isPending} className="btn-ghost border border-ink-border">Back</button>
            <button onClick={submit} disabled={isPending} className="btn-primary">
              {isPending ? <LoadingSpinner size={15} label={step || 'Submitting…'} /> : 'Record on-chain'}
            </button>
          </>
        }
      >
        {pending && (
          <div className="space-y-3">
            <p className="text-xs text-parchment-faint">Trade #{pending.c.requestId} — {pending.c.listing.title}</p>
            <ul className="space-y-2">
              {lines.map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {l.tone === 'bad' ? (
                    <Flame size={15} className="text-signal-danger mt-0.5 shrink-0" />
                  ) : (
                    <CheckCircle2 size={15} className={`${l.tone === 'warn' ? 'text-signal-warn' : 'text-ledger'} mt-0.5 shrink-0`} />
                  )}
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-parchment-faint">This can't be undone.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
