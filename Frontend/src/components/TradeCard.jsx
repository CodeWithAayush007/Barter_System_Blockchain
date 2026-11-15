import { Link } from 'react-router-dom'
import {
  CheckCircle2, Circle, XCircle, AlertOctagon, ArrowDownLeft, ArrowUpRight, Lock, Star, Flame, Clock, Check,
  Truck, Undo2, Handshake, Ban, ImageOff, Camera,
} from 'lucide-react'
import StarRating from './StarRating'
import {
  TRADE_STEPS, TRADE_STATUS, TONE_CLASSES, LISTING_TYPES, formatBtk, formatEth, tradeStepIndex, timeLeft,
  unixAgo, disputeKindLabel, rulingLabel,
} from '../utils/format'
import { tradeHint } from '../utils/trades'
import { useRemoteImage } from '../hooks/useRemoteImage'
import { shortenAddress } from '../blockchain/provider'

function Chip({ tone, children }) {
  return (
    <span className={`text-[11px] font-mono uppercase tracking-wide px-2 py-1 rounded-md border whitespace-nowrap ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  )
}

function Timeline({ status }) {
  const current = tradeStepIndex(status)
  const done = current >= TRADE_STEPS.length
  return (
    <div className="flex items-center" aria-label="Trade progress">
      {TRADE_STEPS.map((step, i) => (
        <div key={step.key} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1.5 shrink-0">
            {i < current || done ? (
              <CheckCircle2 size={18} className="text-ledger" />
            ) : i === current ? (
              <Circle size={18} className="text-copper fill-copper/20" />
            ) : (
              <Circle size={18} className="text-parchment-faint" />
            )}
            <span className={`text-[10px] font-mono uppercase tracking-wide ${i <= current ? 'text-parchment-muted' : 'text-parchment-faint'}`}>
              {step.label}
            </span>
          </div>
          {i < TRADE_STEPS.length - 1 && (
            <div className={`h-px flex-1 mx-2 ${i < current || done ? 'bg-ledger/50' : 'bg-ink-border'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

/** A short list of what the viewer got back, e.g. "50 BTK stake · 0.2 ETH deposit". */
function backLines(o, trade) {
  const lines = []
  if (o.btkBackWei > 0n) lines.push(`${formatBtk(o.btkBackWei)} stake`)
  if (o.ethToMeWei > 0n) {
    let what = 'deposit'
    if (trade.listingType !== 'barter') what = trade.iAmSeller ? 'payment' : 'refund'
    else if (o.ruling === 'claimant_right') what = 'both deposits'
    lines.push(`${formatEth(o.ethToMeWei)} ${what}`)
  }
  if (o.bonusWei > 0n) lines.push(`${formatBtk(o.bonusWei)} bonus`)
  return lines
}

function OutcomeBox({ tone, icon: Icon, title, children }) {
  const toneClasses = {
    ok: 'border-ledger/25 bg-ledger/5 text-ledger',
    bad: 'border-signal-danger/30 bg-signal-danger/5 text-signal-danger',
    warn: 'border-signal-warn/30 bg-signal-warn/5 text-signal-warn',
    muted: 'border-ink-border bg-white/[0.02] text-parchment-muted',
  }[tone]
  return (
    <div className={`rounded-lg border px-3.5 py-3 text-sm space-y-1 ${toneClasses}`}>
      <p className="font-medium flex items-center gap-1.5">
        <Icon size={15} /> {title}
      </p>
      {children && <p className="text-xs text-parchment-muted">{children}</p>}
    </div>
  )
}

/**
 * What the viewer ended up with. Never mentions the stars the other side gave
 * (nor the bonus they imply): ratings are private to the person who gets them.
 */
function Outcome({ trade }) {
  const o = trade.outcome
  if (!o) return null
  const lines = backLines(o, trade)

  if (o.kind === 'completed') {
    return (
      <OutcomeBox tone="ok" icon={CheckCircle2} title="Trade completed">
        {lines.length ? `You got back: ${lines.join(' · ')} — plus your trade reward.` : 'Your trade reward was paid out.'}
        {o.ethPaidWei > 0n && <> You paid {formatEth(o.ethPaidWei)}.</>}
      </OutcomeBox>
    )
  }

  if (o.kind === 'rejected' || o.kind === 'cancelled' || o.kind === 'cancelled_in_escrow') {
    return (
      <OutcomeBox tone="muted" icon={Ban} title={o.kind === 'cancelled_in_escrow' ? 'Called off — everything refunded' : 'Refunded'}>
        {lines.length ? `Returned to you: ${lines.join(' · ')}.` : 'Nothing of yours was locked.'}
      </OutcomeBox>
    )
  }

  // resolved by the admin
  const ruled = rulingLabel(o.ruling)
  if (o.won) {
    return (
      <OutcomeBox tone="ok" icon={CheckCircle2} title={`Ruled in your favour — ${ruled.toLowerCase()}`}>
        {lines.length ? `You got: ${lines.join(' · ')}.` : ''}
        {o.bonusWei > 0n && ' The bonus counts as a 5★ — it is not a rating from the other side.'}
        {o.btkBurnedWei > 0n && ` ${formatBtk(o.btkBurnedWei)} was burned.`}
      </OutcomeBox>
    )
  }
  if (o.btkBurnedWei > 0n) {
    return (
      <OutcomeBox tone="bad" icon={Flame} title={`Ruled against you — ${formatBtk(o.btkBurnedWei)} of your stake was burned`}>
        {lines.length ? `You got back: ${lines.join(' · ')}. ` : ''}
        No bonus is paid to you.
      </OutcomeBox>
    )
  }
  return (
    <OutcomeBox
      tone="warn"
      icon={AlertOctagon}
      title={o.iWasClaimant ? 'Your dispute was ruled unfounded' : 'Ruled for the other side'}
    >
      {lines.length ? `You got back: ${lines.join(' · ')}. ` : ''}No bonus is paid to you.
    </OutcomeBox>
  )
}

/** Who opened a dispute, why, and what the admin decided. */
function DisputeInfo({ trade }) {
  const d = trade.dispute
  if (!d) return null
  const mine = d.raisedBy?.toLowerCase() === trade.myAddress?.toLowerCase()
  return (
    <div className="rounded-lg border border-signal-danger/20 bg-signal-danger/[0.04] px-3.5 py-3 text-xs space-y-1.5">
      <p className="text-signal-danger font-medium flex items-center gap-1.5">
        <AlertOctagon size={14} />
        {mine ? 'You opened this dispute' : `${shortenAddress(d.raisedBy)} opened this dispute`} · {disputeKindLabel(d.kind, trade.listingType)}
      </p>
      {d.reason && <p className="text-parchment-muted">“{d.reason}”</p>}
      <p className="text-parchment-faint">
        {d.resolvedAt ? `Admin ruling: ${rulingLabel(d.ruling)}.` : 'Waiting for the admin to rule.'}
        {d.returnedAt > 0 && d.returnNote ? ` Return note: ${d.returnNote}.` : ''}
        {d.returnResult === 'not_returned' ? ' The item was never returned, so the seller was paid.' : ''}
      </p>
    </div>
  )
}

function PhotoThumb({ trade, onReuploadPhoto, readOnly }) {
  const incoming = trade.direction === 'incoming'
  // The URL is derived from the on-chain hash, so the file might not be on Cloudinary (yet).
  // If it fails to load we drop into the "photo unavailable / upload again" state below.
  const photo = useRemoteImage(trade.photoUrl)
  if (trade.photoUrl && !photo.failed) {
    return (
      <a
        href={trade.photoUrl}
        target="_blank"
        rel="noreferrer"
        className="block shrink-0 group"
        title="Open the full photo"
        data-testid="request-photo-thumb"
      >
        <img
          src={photo.src}
          alt={incoming ? 'Photo of what they offer' : 'Photo of what you offered'}
          onLoad={photo.onLoad}
          onError={photo.onError}
          className={`h-20 w-20 object-cover rounded-lg border border-ink-border group-hover:border-copper/40 transition-colors ${photo.loading ? 'animate-pulse bg-white/[0.04]' : ''}`}
        />
        <span className="block text-[10px] text-parchment-faint mt-1 text-center">{incoming ? 'Their photo' : 'Your photo'}</span>
      </a>
    )
  }
  if (!trade.imageHash) return null
  // A photo was committed on-chain but the file isn't on Cloudinary (upload failed or the backend was down).
  return (
    <div className="shrink-0 w-20 text-center">
      <span className="grid place-items-center h-20 w-20 rounded-lg border border-dashed border-ink-border text-parchment-faint">
        <ImageOff size={18} />
      </span>
      {!incoming && !readOnly && onReuploadPhoto ? (
        <label className="block text-[10px] text-copper mt-1 cursor-pointer hover:underline">
          Upload again
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) onReuploadPhoto(trade, file)
            }}
          />
        </label>
      ) : (
        <span className="block text-[10px] text-parchment-faint mt-1">Photo unavailable</span>
      )}
    </div>
  )
}

/**
 * One trade, from the point of view of the connected wallet. All the data
 * (status, confirmations, shipping, deadlines, amounts) comes from the contract;
 * the buttons shown are exactly the ones the contract would currently accept
 * from this wallet.
 *
 * `onAction(type, trade)` is called for every button; the page decides what each type does.
 */
export default function TradeCard({ trade, busy = false, onAction, onReuploadPhoto, compact = false, readOnly = false }) {
  const statusMeta = TRADE_STATUS[trade.status]
  const typeMeta = LISTING_TYPES[trade.listingType]
  const incoming = trade.direction === 'incoming'
  const stopped = ['rejected', 'cancelled', 'cancelled_in_escrow'].includes(trade.status)
  const has = (a) => trade.actions.includes(a)
  const fire = (type) => () => onAction?.(type, trade)
  const isBarter = trade.listingType === 'barter'
  const locked = trade.lockedBtkWei > 0n || trade.lockedEthWei > 0n
  const hasPhotoSlot = !compact && (trade.photoUrl || trade.imageHash)

  return (
    <div className={`card p-4 sm:p-5 space-y-4 ${trade.needsAction ? 'border-copper/40' : ''}`} data-testid={`trade-${trade.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono text-parchment-muted mb-1">
            {incoming ? <ArrowDownLeft size={13} className="text-ledger" /> : <ArrowUpRight size={13} className="text-copper" />}
            {incoming ? 'Incoming' : 'Outgoing'} · Trade #{trade.id}
            {typeMeta && <span className={typeMeta.color}>· {typeMeta.label}</span>}
            {!isBarter && <span className="text-parchment-faint">· you {trade.iAmBuyer ? 'buy' : 'sell'}</span>}
          </div>
          <h3 className="font-display font-semibold text-parchment truncate">{trade.listingTitle}</h3>
          <p className="text-sm text-parchment-muted mt-0.5">
            with{' '}
            <Link to={`/reputation?address=${trade.counterparty}`} className="font-mono hover:text-parchment underline-offset-2 hover:underline">
              {trade.counterpartyShort}
            </Link>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Chip tone={statusMeta.tone}>{statusMeta.label}</Chip>
          <span className="text-[11px] text-parchment-faint whitespace-nowrap">{trade.updatedAgo}</span>
        </div>
      </div>

      {!compact && (trade.offeredItem || hasPhotoSlot) && (
        <div className="flex items-start gap-3">
          <PhotoThumb trade={trade} onReuploadPhoto={onReuploadPhoto} readOnly={readOnly} />
          {trade.offeredItem && (
            <p className="text-sm text-parchment-muted min-w-0">
              <span className="label mr-2">{incoming ? 'They offer' : 'You offered'}</span>
              <span className="text-parchment">{trade.offeredItem}</span>
              {trade.offeredDescription && <span className="text-parchment-faint"> — {trade.offeredDescription}</span>}
              {!trade.photoUrl && !trade.imageHash && incoming && (
                <span className="flex items-center gap-1 text-xs text-parchment-faint mt-1">
                  <Camera size={12} /> No photo attached
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {!compact && !stopped && <Timeline status={trade.status} />}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-parchment-muted">
        <span className="flex items-center gap-1.5">
          <Lock size={13} className={locked ? 'text-copper' : 'text-parchment-faint'} />
          {locked ? 'You have locked' : trade.status === 'pending' ? 'You lock on accepting' : 'Stake'}{' '}
          <span className="font-mono text-parchment">{formatBtk(trade.lockAmountBtk)}</span>
          {trade.status === 'pending' && !locked ? (
            trade.listing.listingType !== 'sell' && trade.listing.priceWei > 0n && (
              <> + <span className="font-mono text-parchment">{formatEth(trade.listing.priceEth)}</span></>
            )
          ) : (
            (locked ? trade.lockedEthWei : trade.myEthWei) > 0n && (
              <> + <span className="font-mono text-parchment">{formatEth(locked ? trade.lockedEthWei : trade.myEthWei)}</span></>
            )
          )}
          {!locked && trade.status !== 'pending' && (
            <span className="text-parchment-faint">
              ({trade.status === 'completed' || trade.status === 'resolved' ? 'settled' : 'returned'})
            </span>
          )}
          {trade.status === 'awaiting_ratings' && trade.lockedEthWei === 0n && trade.myEthWei > 0n && (
            <span className="text-parchment-faint">· ETH already settled</span>
          )}
        </span>

        {trade.status === 'in_escrow' && isBarter && (
          <span className="flex items-center gap-3">
            <span className={`flex items-center gap-1 ${trade.iConfirmed ? 'text-ledger' : ''}`}>
              {trade.iConfirmed ? <Check size={13} /> : <Circle size={11} />} You
            </span>
            <span className={`flex items-center gap-1 ${trade.theyConfirmed ? 'text-ledger' : ''}`}>
              {trade.theyConfirmed ? <Check size={13} /> : <Circle size={11} />} Them
            </span>
          </span>
        )}

        {trade.status === 'in_escrow' && !isBarter && (
          <span className="flex items-center gap-3">
            <span className={`flex items-center gap-1 ${trade.shipped ? 'text-ledger' : ''}`} data-testid="shipped-state">
              {trade.shipped ? <Truck size={13} /> : <Circle size={11} />}
              {trade.shipped ? `Shipped ${unixAgo(trade.shippedAt)}` : 'Not shipped yet'}
            </span>
            <span className="flex items-center gap-1">
              <Circle size={11} /> Receipt not confirmed
            </span>
          </span>
        )}

        {trade.status === 'awaiting_ratings' && (
          <>
            <span className="flex items-center gap-1.5">
              You rated: {trade.starsIGave ? <StarRating value={trade.starsIGave} size={13} /> : <span className="text-parchment-faint">not yet</span>}
            </span>
            <span className="flex items-center gap-1.5">
              They have rated you: {trade.theyRated ? <span className="text-ledger">yes</span> : <span className="text-parchment-faint">not yet</span>}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={13} /> {timeLeft(trade.ratingDeadline)}
            </span>
          </>
        )}
      </div>

      {trade.shipped && trade.shippingNote && trade.status === 'in_escrow' && (
        <p className="text-xs text-parchment-muted">
          <span className="label mr-2">Shipping note</span>
          {trade.shippingNote}
        </p>
      )}

      {trade.status === 'in_escrow' && trade.cancelState !== 'none' && (
        <p className="flex items-center gap-1.5 text-xs text-signal-warn" data-testid="cancel-state">
          <Handshake size={13} />
          {trade.cancelState === 'mine'
            ? 'You proposed calling this trade off — waiting for their answer.'
            : `${trade.counterpartyShort} proposes calling this trade off. Agree and everything locked is refunded to both of you.`}
        </p>
      )}

      <DisputeInfo trade={trade} />
      <Outcome trade={trade} />

      {!compact && <p className="text-xs text-parchment-faint">{tradeHint(trade)}</p>}

      {!readOnly && trade.actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {has('accept') && (
            <button disabled={busy} onClick={fire('accept')} className="btn-primary !px-4 !py-2 text-sm disabled:opacity-60">
              Accept &amp; lock {formatBtk(trade.lockAmountBtk)}
              {trade.listing.listingType !== 'sell' && trade.listing.priceWei > 0n && ` + ${formatEth(trade.listing.priceEth)}`}
            </button>
          )}
          {has('reject') && (
            <button disabled={busy} onClick={fire('reject')} className="btn-ghost text-sm border border-ink-border disabled:opacity-60">
              <XCircle size={15} /> Reject
            </button>
          )}
          {has('cancel') && (
            <button disabled={busy} onClick={fire('cancel')} className="btn-ghost text-sm border border-ink-border disabled:opacity-60">
              <XCircle size={15} /> Cancel request
            </button>
          )}
          {has('ship') && (
            <button disabled={busy} onClick={fire('ship')} className="btn-primary !px-4 !py-2 text-sm disabled:opacity-60">
              <Truck size={15} /> Mark as shipped
            </button>
          )}
          {has('confirm') && (
            <button disabled={busy} onClick={fire('confirm')} className="btn-primary !px-4 !py-2 text-sm disabled:opacity-60">
              <CheckCircle2 size={15} /> {isBarter ? 'Confirm exchange done' : 'Confirm item received'}
            </button>
          )}
          {has('markReturned') && (
            <button disabled={busy} onClick={fire('markReturned')} className="btn-primary !px-4 !py-2 text-sm disabled:opacity-60">
              <Undo2 size={15} /> I sent the item back
            </button>
          )}
          {has('confirmReturn') && (
            <button disabled={busy} onClick={fire('confirmReturn')} className="btn-primary !px-4 !py-2 text-sm disabled:opacity-60">
              <CheckCircle2 size={15} /> Item returned to me
            </button>
          )}
          {has('rate') && (
            <button disabled={busy} onClick={fire('rate')} className="btn-primary !px-4 !py-2 text-sm disabled:opacity-60">
              <Star size={15} /> Rate {trade.counterpartyShort}
            </button>
          )}
          {has('finalize') && (
            <button disabled={busy} onClick={fire('finalize')} className="btn-primary !px-4 !py-2 text-sm disabled:opacity-60">
              Finalise &amp; release stakes
            </button>
          )}
          {has('acceptCancel') && (
            <button disabled={busy} onClick={fire('acceptCancel')} className="btn-secondary !px-4 !py-2 text-sm disabled:opacity-60">
              <Handshake size={15} /> Agree to call it off
            </button>
          )}
          {has('declineCancel') && (
            <button disabled={busy} onClick={fire('declineCancel')} className="btn-ghost text-sm border border-ink-border disabled:opacity-60">
              Keep the trade going
            </button>
          )}
          {has('proposeCancel') && (
            <button disabled={busy} onClick={fire('proposeCancel')} className="btn-ghost text-sm border border-ink-border disabled:opacity-60">
              <Ban size={15} /> Call the trade off
            </button>
          )}
          {has('withdrawCancel') && (
            <button disabled={busy} onClick={fire('withdrawCancel')} className="btn-ghost text-sm border border-ink-border disabled:opacity-60">
              Withdraw my proposal
            </button>
          )}
          {has('dispute') && (
            <button
              disabled={busy}
              onClick={fire('dispute')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-signal-danger hover:bg-signal-danger/10 transition-colors disabled:opacity-60"
            >
              <AlertOctagon size={15} /> Open a dispute
            </button>
          )}
        </div>
      )}
    </div>
  )
}
