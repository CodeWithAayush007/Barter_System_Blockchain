import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, SlidersHorizontal, Lock, AlertTriangle, Camera, ShieldCheck } from 'lucide-react'
import ListingCard from '../components/ListingCard'
import Modal from '../components/Modal'
import LoadingSpinner from '../components/LoadingSpinner'
import ChainUnavailable from '../components/ChainUnavailable'
import PhotoPicker from '../components/PhotoPicker'
import { CATEGORIES } from '../utils/categories'
import { LISTING_TYPES, LISTING_TYPE_ORDER, formatBtk, formatEth } from '../utils/format'
import { sanitizeText, validateTradeRequestForm, hasErrors } from '../utils/validation'
import { useListings } from '../hooks/useListings'
import { useBarter } from '../hooks/useBarter.jsx'
import { useAdmin } from '../hooks/useAdmin'
import { useAuth } from '../hooks/useAuth.jsx'
import { useToasts } from '../hooks/useToasts.jsx'
import { hashImageFile } from '../utils/listingMeta'
import { uploadRequestPhoto } from '../utils/requestMeta'
import { useTokenBalance } from '../hooks/useTokenBalance'
import { useChainAction, useWriteGate } from '../hooks/useChainAction'

const STATUS_FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'in_trade', label: 'In trade' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
]

export default function Marketplace() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('open')

  const [selected, setSelected] = useState(null) // listing being requested
  const [requestForm, setRequestForm] = useState({ offeredItem: '', offeredDescription: '' })
  const [requestErrors, setRequestErrors] = useState({})
  const [requestDone, setRequestDone] = useState(false)
  const [requestPhoto, setRequestPhoto] = useState(null) // photo of what the requester offers
  const [photoWarning, setPhotoWarning] = useState('') // set when the request went through but the photo upload failed
  const [lastRequestId, setLastRequestId] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [closing, setClosing] = useState(null) // listing being closed

  const { address, chainStatus } = useBarter()
  const { listings, allListings, loading, error } = useListings({ search: query, category, type, status })
  const { balance, balanceWei } = useTokenBalance()
  const gate = useWriteGate()
  const { perform, isPending, step, reset } = useChainAction()
  const { isAdmin } = useAdmin()
  const { isAuthenticated, signIn, signingIn } = useAuth()
  const { push } = useToasts()

  const me = address?.toLowerCase()
  const chainDown = ['undeployed', 'unreachable', 'no-contract'].includes(chainStatus.state)

  const openRequest = (listing) => {
    reset()
    setRequestForm({ offeredItem: '', offeredDescription: '' })
    setRequestErrors({})
    setRequestDone(false)
    setRequestPhoto(null)
    setPhotoWarning('')
    setLastRequestId(null)
    setSelected(listing)
  }

  const confirmRequest = async () => {
    if (!gate.canWrite) {
      await gate.fix?.()
      return
    }
    const errors = validateTradeRequestForm(requestForm, selected.listingType)
    if (hasErrors(errors)) {
      setRequestErrors(errors)
      return
    }

    // With a photo, sign in to the backend *first*: if that signature is declined nothing has been spent yet.
    let imageHash = ''
    if (requestPhoto && wantsPhoto) {
      if (!isAuthenticated) {
        const { ok, error } = await signIn()
        if (!ok) {
          push({
            type: 'error',
            title: 'Sign-in needed for the photo',
            message: error || 'Sign the message to upload a photo, or remove the photo to request without one.',
          })
          return
        }
      }
      imageHash = await hashImageFile(requestPhoto)
    }

    const res = await perform(
      (service, onStep) =>
        service.requestTrade(
          {
            listing: selected,
            offeredItem: sanitizeText(requestForm.offeredItem),
            offeredDescription: sanitizeText(requestForm.offeredDescription),
            imageHash,
          },
          { onStep }
        ),
      {
        success: { title: 'Trade requested', message: `Your stake is locked. Waiting for the owner of "${selected.title}".` },
        failureTitle: 'Request failed',
      }
    )
    if (!res.ok) return

    const requestId = res.result.requestId
    setLastRequestId(requestId)
    if (imageHash && requestId) {
      const problem = await uploadRequestPhoto(requestId, requestPhoto)
      setPhotoWarning(problem || '')
    }
    setRequestDone(true)
  }

  const retryPhoto = async () => {
    setRetrying(true)
    if (!isAuthenticated) {
      const { ok } = await signIn()
      if (!ok) {
        setRetrying(false)
        return
      }
    }
    const problem = await uploadRequestPhoto(lastRequestId, requestPhoto)
    setPhotoWarning(problem || '')
    setRetrying(false)
  }

  const confirmClose = async () => {
    const listing = closing
    const res = await perform((service, onStep) => service.deactivateListing(listing.id, { onStep }), {
      success: { title: 'Listing closed', message: `"${listing.title}" no longer accepts requests.` },
      failureTitle: 'Could not close listing',
    })
    if (res.ok) setClosing(null)
  }

  // A sell request is just a payment, so there is no item to photograph; barter and buy requests offer an item.
  const wantsPhoto = !!selected && selected.listingType !== 'sell'
  const lockWei = selected?.lockAmountWei ?? 0n
  const notEnoughBtk = !!selected && gate.canWrite && balanceWei < lockWei

  return (
    <div className="max-w-7xl mx-auto px-5 sm:px-8 py-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <p className="label mb-1">Marketplace</p>
          <h1 className="font-display font-semibold text-2xl text-parchment">Browse listings</h1>
          <p className="text-xs text-parchment-faint mt-1">Read live from the BarterAgreement contract.</p>
        </div>
        <span className="text-sm text-parchment-muted">
          {loading ? <LoadingSpinner size={14} label="Reading chain…" /> : `${listings.length} of ${allListings.length} listings`}
        </span>
      </div>

      <ChainUnavailable />

      {isAdmin && (
        <p className="mb-6 rounded-lg border border-ink-border bg-white/[0.02] px-4 py-3 text-sm text-parchment-muted">
          You are signed in as the platform admin. You can browse the marketplace, but the admin does not trade — your job is ruling on
          disputes.
        </p>
      )}

      {!chainDown && (
        <>
          {/* Search + filters */}
          <div className="flex flex-col lg:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-parchment-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search listings by item or service…"
                className="input-field pl-10"
              />
            </div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-field lg:w-56">
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-8">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {['all', ...LISTING_TYPE_ORDER].map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-mono uppercase tracking-wide border transition-colors ${
                    type === t ? 'bg-copper/15 border-copper/40 text-copper' : 'border-ink-border text-parchment-muted hover:text-parchment'
                  }`}
                >
                  {t === 'all' ? 'All types' : LISTING_TYPES[t].label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <SlidersHorizontal size={15} className="text-parchment-faint shrink-0" />
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setStatus(s.key)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-mono uppercase tracking-wide border transition-colors ${
                    status === s.key ? 'bg-ledger/15 border-ledger/40 text-ledger' : 'border-ink-border text-parchment-muted hover:text-parchment'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {error && !loading && <p className="text-signal-danger text-sm mb-4">{error}</p>}

          {loading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card h-80 animate-pulse bg-white/[0.02]" />
              ))}
            </div>
          ) : listings.length === 0 ? (
            <div className="text-center py-24">
              <p className="text-parchment-muted">
                {allListings.length === 0 ? 'No listings have been created on-chain yet.' : 'No listings match your filters.'}
              </p>
              <p className="text-sm text-parchment-faint mt-1">
                {allListings.length === 0 ? (
                  <>Be the first — <Link to="/create" className="text-copper hover:text-copper-400">create a listing</Link>.</>
                ) : (
                  'Try a different search term, category or status.'
                )}
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {listings.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  isOwn={!!me && listing.ownerLower === me}
                  canTrade={!isAdmin}
                  onRequestTrade={openRequest}
                  onDeactivate={(l) => { reset(); setClosing(l) }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Request a trade ─────────────────────────────────────────────── */}
      <Modal
        open={!!selected}
        onClose={() => !isPending && setSelected(null)}
        title={requestDone ? 'Trade requested' : 'Request this trade'}
        footer={
          requestDone ? (
            <>
              <Link to="/trades" className="btn-secondary" onClick={() => setSelected(null)}>View my trades</Link>
              <button onClick={() => setSelected(null)} className="btn-primary">Done</button>
            </>
          ) : (
            <>
              <button onClick={() => setSelected(null)} disabled={isPending} className="btn-ghost border border-ink-border">Cancel</button>
              <button onClick={confirmRequest} disabled={isPending || gate.busy || notEnoughBtk} className="btn-primary">
                {isPending ? (
                  <LoadingSpinner size={15} label={step || 'Sending…'} />
                ) : !gate.canWrite ? (
                  gate.label
                ) : (
                  `Lock ${selected ? formatBtk(selected.lockAmountBtk) : ''}${
                    selected && selected.listingType !== 'buy' ? ` + ${formatEth(selected.priceEth)}` : ''
                  } & request`
                )}
              </button>
            </>
          )
        }
      >
        {selected && !requestDone && (
          <div className="space-y-4">
            <p>
              <span className="text-parchment font-medium">{selected.title}</span>{' '}
              <span className="text-parchment-faint">by</span>{' '}
              <span className="font-mono text-parchment">{selected.ownerShort}</span>
            </p>

            {selected.listingType !== 'sell' && (
              <div className="space-y-3">
                <div>
                  <label className="label block mb-1.5">
                    {selected.listingType === 'buy' ? 'What you are selling them' : 'What you are offering in exchange'}
                  </label>
                  <input
                    value={requestForm.offeredItem}
                    onChange={(e) => { setRequestForm((f) => ({ ...f, offeredItem: e.target.value })); setRequestErrors({}) }}
                    placeholder={selected.listingType === 'barter' ? `They want: ${selected.seeking}` : 'Item name'}
                    maxLength={100}
                    className="input-field"
                  />
                  {requestErrors.offeredItem && <p className="text-signal-danger text-xs mt-1.5">{requestErrors.offeredItem}</p>}
                </div>
                <div>
                  <label className="label block mb-1.5">Details <span className="normal-case tracking-normal text-parchment-faint">(optional)</span></label>
                  <textarea
                    rows={2}
                    value={requestForm.offeredDescription}
                    onChange={(e) => setRequestForm((f) => ({ ...f, offeredDescription: e.target.value }))}
                    placeholder="Condition, specs…"
                    maxLength={500}
                    className="input-field resize-none"
                  />
                  {requestErrors.offeredDescription && <p className="text-signal-danger text-xs mt-1.5">{requestErrors.offeredDescription}</p>}
                </div>
                <div>
                  <label className="label block mb-1.5 flex items-center gap-1.5">
                    <Camera size={13} /> Photo of your item{' '}
                    <span className="normal-case tracking-normal text-parchment-faint">(optional, but it helps)</span>
                  </label>
                  <PhotoPicker
                    file={requestPhoto}
                    onChange={setRequestPhoto}
                    onProblem={(message) => push({ type: 'error', title: 'Image not accepted', message })}
                    height="h-32"
                    hint="Show what you're offering and its condition (max 5MB)"
                    testId="request-photo"
                  />
                  <p className="text-xs text-parchment-faint mt-1.5 flex items-start gap-1.5">
                    <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                    The owner sees this photo next to your request. Its SHA-256 fingerprint is recorded on-chain with the request.
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-lg bg-ink border border-ink-border p-3.5 space-y-2 text-xs">
              <p className="flex items-center gap-1.5 text-parchment">
                <Lock size={13} className="text-copper" /> Locked from your wallet now
              </p>
              <ul className="space-y-1 text-parchment-muted">
                <li>
                  • <span className="font-mono text-copper">{formatBtk(selected.lockAmountBtk)}</span> stake — returned when the trade settles,
                  plus 5% of it for every star the other side rates you.
                </li>
                {selected.listingType === 'barter' && (
                  <li>
                    • <span className="font-mono text-copper">{formatEth(selected.priceEth)}</span> deposit — the owner locks the same
                    amount. You each get your ETH back as soon as the swap is confirmed.
                  </li>
                )}
                {selected.listingType === 'sell' && (
                  <li>
                    • <span className="font-mono text-copper">{formatEth(selected.priceEth)}</span> purchase price, held by the Escrow
                    contract until you confirm you received the item — then the seller is paid.
                  </li>
                )}
                {selected.listingType === 'buy' && (
                  <li>
                    • No ETH from you — the buyer locks {formatEth(selected.priceEth)} when they accept, and you are paid when they
                    confirm receipt.
                  </li>
                )}
              </ul>
              {gate.canWrite && (
                <p className="text-parchment-faint">Your balance: {formatBtk(balance)}</p>
              )}
            </div>

            {notEnoughBtk && (
              <p className="flex items-start gap-2 text-signal-warn text-xs">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  You need {formatBtk(selected.lockAmountBtk)} to lock but have {formatBtk(balance)}.{' '}
                  <Link to="/tokens" className="underline">Claim your starter BTK</Link>.
                </span>
              </p>
            )}
            <p className="text-xs text-parchment-faint">
              Your wallet will ask for up to two confirmations: first to let the escrow lock the BTK, then to send the request.
            </p>
          </div>
        )}
        {selected && requestDone && (
          <div className="space-y-3">
            <p>
              Your request for <span className="text-parchment font-medium">{selected.title}</span> is recorded on-chain and your stake is
              locked in escrow. If the owner accepts, you'll both go ahead with the trade here; if they reject it, everything you locked
              is returned automatically.
            </p>
            {photoWarning && (
              <div className="rounded-lg border border-signal-warn/30 bg-signal-warn/5 px-3.5 py-3 text-xs">
                <p className="flex items-center gap-2 text-signal-warn font-medium">
                  <AlertTriangle size={14} /> The photo didn't upload
                </p>
                <p className="text-parchment-muted mt-1">
                  {photoWarning} Your request itself is fine — only the picture is missing.
                </p>
                <button onClick={retryPhoto} disabled={retrying || signingIn} className="btn-secondary !py-1.5 mt-2.5 text-sm">
                  {retrying || signingIn ? <LoadingSpinner size={14} label="Uploading…" /> : 'Retry photo upload'}
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Close one of my listings ────────────────────────────────────── */}
      <Modal
        open={!!closing}
        onClose={() => !isPending && setClosing(null)}
        title="Close this listing?"
        footer={
          <>
            <button onClick={() => setClosing(null)} disabled={isPending} className="btn-ghost border border-ink-border">Keep open</button>
            <button onClick={confirmClose} disabled={isPending} className="btn-primary">
              {isPending ? <LoadingSpinner size={15} label={step || 'Closing…'} /> : 'Close listing'}
            </button>
          </>
        }
      >
        {closing && (
          <div className="space-y-2">
            <p>
              <span className="text-parchment font-medium">{closing.title}</span> will stop accepting new requests. This is recorded on-chain and can't be undone.
            </p>
            {closing.pendingRequests > 0 && (
              <p className="text-signal-warn text-xs">
                {closing.pendingRequests} request{closing.pendingRequests === 1 ? ' is' : 's are'} still pending. Reject them on the Trades
                page to refund the requesters right away — otherwise they can cancel and reclaim their stake themselves.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
