import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { CheckCircle2, Repeat, Tag, HandCoins, Lock, AlertTriangle, ShieldCheck } from 'lucide-react'
import { CATEGORIES } from '../utils/categories'
import { LISTING_TYPES, LISTING_TYPE_ORDER, BTK_PER_ETH, suggestLock } from '../utils/format'
import { validateListingForm, hasErrors, sanitizeText } from '../utils/validation'
import { hashImageFile, uploadListingPhoto } from '../utils/listingMeta'
import { useAuth } from '../hooks/useAuth.jsx'
import { useToasts } from '../hooks/useToasts.jsx'
import { useRules } from '../hooks/useRules'
import { useChainAction, useWriteGate } from '../hooks/useChainAction'
import LoadingSpinner from '../components/LoadingSpinner'
import PhotoPicker from '../components/PhotoPicker'
import ChainUnavailable from '../components/ChainUnavailable'

const TYPE_ICONS = { barter: Repeat, sell: Tag, buy: HandCoins }

const TYPE_COPY = {
  barter: {
    titlePlaceholder: 'e.g. Mechanical Keyboard (Hot-swappable)',
    blurb: 'Swap this item (or service) directly for something else. Both sides lock BTK and an ETH deposit while the swap happens.',
    priceLabel: 'ETH stake (Y) — each side locks this',
    priceHint: 'You and your partner each lock this ETH. You both get it back once the swap is confirmed.',
  },
  sell: {
    titlePlaceholder: 'e.g. Vintage Film Camera',
    blurb: 'Sell this for ETH. The buyer\'s ETH is locked in escrow the moment they request the trade.',
    priceLabel: 'Price (ETH)',
    priceHint: 'Locked from the buyer\'s wallet the moment they request this trade. You are paid when they confirm receipt.',
  },
  buy: {
    titlePlaceholder: 'e.g. Wanted: Turntable',
    blurb: 'Post what you want to buy. Your ETH offer is locked in escrow when you accept a seller.',
    priceLabel: 'Your offer (ETH)',
    priceHint: 'Locked from your wallet the moment you accept a seller. The seller is paid when you confirm receipt.',
  },
}

// What each side puts in escrow, by listing type — shown under the lock amount.
function lockSummary(type, x, y) {
  if (type === 'barter') {
    return `Both of you lock ${x} BTK and ${y} ETH. Each of you gets your ETH back as soon as the swap is confirmed, and your BTK back plus a bonus after ratings.`
  }
  if (type === 'sell') {
    return `You lock ${x} BTK when you accept a request. The buyer locks ${x} BTK and ${y} ETH when they request. When the buyer confirms receipt you are paid ${y} ETH and get your BTK back plus a bonus.`
  }
  return `The seller locks ${x} BTK when they request. You lock ${x} BTK and ${y} ETH when you accept them. When you confirm receipt the seller is paid ${y} ETH; you get your BTK back plus a bonus.`
}

const initialForm = {
  listingType: 'barter',
  title: '',
  description: '',
  category: CATEGORIES[0],
  exchange: '',
  price: '',
  lockAmount: '10',
}


export default function CreateListing() {
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [fieldErrors, setFieldErrors] = useState({})
  const [imageFile, setImageFile] = useState(null)
  const [lockEdited, setLockEdited] = useState(false) // once X is typed by hand we stop suggesting it
  const [created, setCreated] = useState(null) // { listingId, title, uploadError }
  const [retrying, setRetrying] = useState(false)

  const gate = useWriteGate()
  const { isAuthenticated, signIn, signingIn } = useAuth()
  const { perform, isPending, step } = useChainAction()
  const { push } = useToasts()
  const { rules } = useRules()

  const isBarter = form.listingType === 'barter'
  const lockNumber = Number(form.lockAmount)
  const validLock = Number.isFinite(lockNumber) && lockNumber > 0

  const update = (key) => (e) => {
    const value = e.target.value
    setForm((f) => {
      const next = { ...f, [key]: value }
      // X is suggested from Y until the owner sets it themselves.
      if (key === 'price' && !lockEdited) {
        const suggestion = suggestLock(value, rules.minimumLockBtk)
        if (suggestion) next.lockAmount = suggestion
      }
      return next
    })
    if (key === 'lockAmount') setLockEdited(true)
    if (fieldErrors[key]) setFieldErrors((fe) => ({ ...fe, [key]: undefined }))
  }

  const selectType = (listingType) => {
    setForm((f) => ({ ...f, listingType }))
    setFieldErrors({})
  }

  const pickImage = (file) => {
    setImageFile(file)
    if (file) setFieldErrors((fe) => ({ ...fe, image: undefined }))
  }

  // The photo is a file, so it can't live on the blockchain. The chain keeps its
  // SHA-256 fingerprint; the backend only accepts the file if it matches that fingerprint
  // *and* the uploader owns the on-chain listing, and then stores it on Cloudinary.
  // Returns null on success, or a readable error message.
  const uploadPhoto = (listingId, file) => uploadListingPhoto(listingId, file)

  const handleSubmit = async (e) => {
    e.preventDefault()

    const errors = validateListingForm(form, { minLock: rules.minimumLockBtk, hasPhoto: !!imageFile })
    if (hasErrors(errors)) {
      setFieldErrors(errors)
      return
    }

    if (!gate.canWrite) {
      await gate.fix?.()
      return
    }

    // With a photo, sign in to the backend *first*: if that signature is
    // declined nothing has been spent yet.
    let imageHash = ''
    if (imageFile) {
      if (!isAuthenticated) {
        const { ok, error } = await signIn()
        if (!ok) {
          push({
            type: 'error',
            title: 'Sign-in needed for the photo',
            message: error || 'Sign the message to upload a photo, or remove the photo to list without one.',
          })
          return
        }
      }
      imageHash = await hashImageFile(imageFile)
    }

    const title = sanitizeText(form.title)
    const res = await perform(
      (service, onStep) =>
        service.createListing(
          {
            listingType: form.listingType,
            title,
            category: form.category,
            description: sanitizeText(form.description),
            seeking: isBarter ? sanitizeText(form.exchange) : '',
            imageHash,
            priceEth: form.price,
            lockBtk: form.lockAmount,
          },
          { onStep }
        ),
      {
        success: { title: 'Listing created', message: 'Your listing is recorded on the blockchain.' },
        failureTitle: 'Could not create listing',
      }
    )
    if (!res.ok) return

    const listingId = res.result.listingId
    const uploadError = imageFile ? await uploadPhoto(listingId, imageFile) : null
    setCreated({ listingId, title, uploadError })
  }

  const retryUpload = async () => {
    setRetrying(true)
    if (!isAuthenticated) {
      const { ok } = await signIn()
      if (!ok) {
        setRetrying(false)
        return
      }
    }
    const uploadError = await uploadPhoto(created.listingId, imageFile)
    setCreated((c) => ({ ...c, uploadError }))
    setRetrying(false)
  }

  const reset = () => {
    setCreated(null)
    setForm(initialForm)
    setImageFile(null)
    setLockEdited(false)
    setFieldErrors({})
  }

  if (created) {
    return (
      <div className="max-w-md mx-auto py-24 text-center px-5">
        <span className="grid place-items-center h-14 w-14 rounded-2xl bg-ledger/10 border border-ledger/25 mx-auto mb-5">
          <CheckCircle2 size={24} className="text-ledger" />
        </span>
        <h1 className="font-display font-semibold text-2xl text-parchment mb-2">Listing #{created.listingId} is on-chain</h1>
        <p className="text-parchment-muted text-sm mb-6">
          "{created.title}" is now recorded on the blockchain and ready to receive trade requests.
        </p>
        {created.uploadError && (
          <div className="rounded-lg border border-signal-warn/30 bg-signal-warn/5 px-4 py-3 text-left text-sm mb-6">
            <p className="flex items-center gap-2 text-signal-warn font-medium">
              <AlertTriangle size={15} /> The photo didn't upload
            </p>
            <p className="text-xs text-parchment-muted mt-1">
              {created.uploadError} The listing itself is fine — only the picture is missing.
            </p>
            <button onClick={retryUpload} disabled={retrying || signingIn} className="btn-secondary !py-1.5 mt-3 text-sm">
              {retrying || signingIn ? <LoadingSpinner size={14} label="Uploading…" /> : 'Retry photo upload'}
            </button>
          </div>
        )}
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/marketplace')} className="btn-primary">View in Marketplace</button>
          <button onClick={reset} className="btn-secondary">Create Another</button>
        </div>
      </div>
    )
  }

  const bonus5 = validLock ? (lockNumber * rules.bonusPercent * rules.maxStars) / 100 : 0

  return (
    <div className="max-w-2xl mx-auto px-5 sm:px-8 py-10">
      <p className="label mb-1">New Listing</p>
      <h1 className="font-display font-semibold text-2xl text-parchment mb-8">List something on the platform</h1>

      <ChainUnavailable />

      <form onSubmit={handleSubmit} className="card p-6 sm:p-8 space-y-6" noValidate>
        <div>
          <label className="label block mb-2">Listing Type</label>
          <div className="grid grid-cols-3 gap-2">
            {LISTING_TYPE_ORDER.map((type) => {
              const Icon = TYPE_ICONS[type]
              const meta = LISTING_TYPES[type]
              const active = form.listingType === type
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => selectType(type)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-xs font-medium transition-colors ${
                    active
                      ? 'border-copper/50 bg-copper/10 text-copper'
                      : 'border-ink-border bg-ink text-parchment-muted hover:border-copper/25'
                  }`}
                >
                  <Icon size={16} />
                  {meta.label}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-parchment-muted mt-2">{TYPE_COPY[form.listingType].blurb}</p>
        </div>

        <div>
          <label className="label block mb-2">{form.listingType === 'buy' ? 'What You Want to Buy' : 'Item Title'}</label>
          <input
            value={form.title}
            onChange={update('title')}
            placeholder={TYPE_COPY[form.listingType].titlePlaceholder}
            maxLength={100}
            className="input-field"
          />
          {fieldErrors.title && <p className="text-signal-danger text-xs mt-1.5">{fieldErrors.title}</p>}
        </div>

        <div>
          <label className="label block mb-2">Description</label>
          <textarea
            rows={4}
            value={form.description}
            onChange={update('description')}
            placeholder="Condition, details, why you're trading it…"
            maxLength={1000}
            className="input-field resize-none"
          />
          {fieldErrors.description && <p className="text-signal-danger text-xs mt-1.5">{fieldErrors.description}</p>}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label block mb-2">Category</label>
            <select value={form.category} onChange={update('category')} className="input-field">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="label block mb-2" htmlFor="price">{TYPE_COPY[form.listingType].priceLabel}</label>
            <input
              id="price"
              type="number"
              step="0.001"
              min="0"
              value={form.price}
              onChange={update('price')}
              placeholder="0.05"
              className="input-field font-mono"
            />
            {fieldErrors.price && <p className="text-signal-danger text-xs mt-1.5">{fieldErrors.price}</p>}
            <p className="text-xs text-parchment-faint mt-1.5">{TYPE_COPY[form.listingType].priceHint}</p>
          </div>
        </div>

        {isBarter && (
          <div>
            <label className="label block mb-2">Expected Exchange</label>
            <input
              value={form.exchange}
              onChange={update('exchange')}
              placeholder="What are you hoping to receive in return?"
              maxLength={200}
              className="input-field"
            />
            {fieldErrors.exchange && <p className="text-signal-danger text-xs mt-1.5">{fieldErrors.exchange}</p>}
          </div>
        )}

        {/* The rule from the barter workflow: X is set by the listing owner, both sides lock it. */}
        <div className="rounded-lg border border-copper/25 bg-copper/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Lock size={15} className="text-copper" />
            <label className="label !text-copper" htmlFor="lockAmount">Locking amount (X) — BTK</label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="lockAmount"
              type="number"
              min="0"
              step="any"
              value={form.lockAmount}
              onChange={update('lockAmount')}
              className="input-field font-mono !w-36"
            />
            {['10', '25', '50', '100'].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setLockEdited(true)
                  setForm((f) => ({ ...f, lockAmount: v }))
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-mono border transition-colors ${
                  form.lockAmount === v ? 'border-copper/50 text-copper bg-copper/10' : 'border-ink-border text-parchment-muted hover:text-parchment'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          {fieldErrors.lockAmount && <p className="text-signal-danger text-xs">{fieldErrors.lockAmount}</p>}
          <p className="text-xs text-parchment-muted leading-relaxed">
            {lockSummary(form.listingType, validLock ? lockNumber : 'X', Number(form.price) > 0 ? form.price : 'Y')}
          </p>
          <p className="text-xs text-parchment-muted leading-relaxed">
            After a smooth trade each side gets their BTK back plus {rules.bonusPercent}% of it per star the other person rates
            them — up to{' '}
            <span className="text-parchment">{validLock ? `+${bonus5.toLocaleString(undefined, { maximumFractionDigits: 3 })} BTK` : `+${rules.bonusPercent * rules.maxStars}%`}</span>{' '}
            at 5★. Nothing is taken from you until you accept a request. Minimum: {rules.minimumLockBtk} BTK.
          </p>
          <p className="text-xs text-parchment-faint leading-relaxed">
            Suggested from the ETH amount at {BTK_PER_ETH} BTK per 1 ETH — change it to whatever you think is fair.
          </p>
        </div>

        <div>
          <label className="label block mb-2">
            Item Image{' '}
            <span className="normal-case tracking-normal text-parchment-faint">
              {form.listingType === 'sell' ? '(required for a sell listing)' : '(optional)'}
            </span>
          </label>
          <PhotoPicker
            file={imageFile}
            onChange={pickImage}
            onProblem={(message) => push({ type: 'error', title: 'Image not accepted', message })}
            hint="Click to upload an image (max 5MB)"
            testId="listing-photo"
          />
          {fieldErrors.image && <p className="text-signal-danger text-xs mt-1.5">{fieldErrors.image}</p>}
          <p className="text-xs text-parchment-faint mt-1.5 flex items-start gap-1.5">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            The photo file is stored on Cloudinary; its SHA-256 fingerprint is written to the blockchain with your listing so it can't be swapped later.
          </p>
        </div>

        <button type="submit" disabled={isPending || signingIn || gate.busy} className="w-full btn-primary">
          {isPending ? (
            <LoadingSpinner size={16} label={step || 'Submitting…'} />
          ) : signingIn ? (
            <LoadingSpinner size={16} label="Sign in to upload the photo…" />
          ) : !gate.canWrite ? (
            gate.label
          ) : (
            'Create Listing on-chain'
          )}
        </button>
        <p className="text-xs text-parchment-faint text-center">
          This sends a transaction to the BarterAgreement contract. Your wallet will ask you to confirm it.{' '}
          <Link to="/rules" className="text-copper hover:text-copper-400">Read the barter rules</Link>
        </p>
      </form>
    </div>
  )
}
