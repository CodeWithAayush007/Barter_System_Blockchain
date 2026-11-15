import { Link } from 'react-router-dom'
import { Lock, ArrowRight, Repeat, Tag, HandCoins, Power } from 'lucide-react'
import ReputationBadge from './ReputationBadge'
import { LISTING_TYPES, formatBtk, formatEth } from '../utils/format'
import { placeholderImage } from '../utils/placeholder'
import { useRemoteImage } from '../hooks/useRemoteImage'

const STATUS = {
  open: { label: 'Open', style: 'bg-ledger/10 text-ledger border-ledger/30' },
  in_trade: { label: 'In trade', style: 'bg-signal-warn/10 text-signal-warn border-signal-warn/30' },
  closed: { label: 'Closed', style: 'bg-parchment-muted/10 text-parchment-muted border-parchment-muted/20' },
}

const TYPE_ICONS = { barter: Repeat, sell: Tag, buy: HandCoins }

export default function ListingCard({ listing, isOwn = false, canTrade = true, onRequestTrade, onDeactivate }) {
  const status = STATUS[listing.status] || STATUS.open
  const listingType = listing.listingType || 'barter'
  const typeMeta = LISTING_TYPES[listingType] || LISTING_TYPES.barter
  const TypeIcon = TYPE_ICONS[listingType] || Repeat
  const isCashListing = listingType === 'sell' || listingType === 'buy'
  const price = `${listing.priceEth} Ξ`
  // The photo URL comes from the on-chain hash, so the file may not be on Cloudinary (yet): fall back to the placeholder.
  const photo = useRemoteImage(listing.hasPhoto ? listing.image : null)
  const showPhoto = listing.hasPhoto && !photo.failed

  return (
    <div className="card overflow-hidden group hover:border-copper/30 hover:-translate-y-0.5 transition-all duration-300 flex flex-col">
      <div className="relative h-40 overflow-hidden">
        {showPhoto && photo.loading && <div className="absolute inset-0 animate-pulse bg-white/[0.04]" />}
        <img
          src={showPhoto ? photo.src : placeholderImage(listingType)}
          alt={showPhoto ? listing.title : ''}
          onLoad={showPhoto ? photo.onLoad : undefined}
          onError={showPhoto ? photo.onError : undefined}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-surface via-transparent to-transparent" />
        <span className={`absolute top-3 left-3 text-[11px] font-mono uppercase tracking-wide px-2 py-1 rounded-md border ${status.style}`}>
          {status.label}
        </span>
        <span className="absolute top-3 right-3 text-[11px] font-mono px-2 py-1 rounded-md bg-ink/70 text-parchment-muted border border-ink-border">
          {listing.category}
        </span>
      </div>

      <div className="p-4 space-y-3 flex-1 flex flex-col">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <TypeIcon size={12} className={typeMeta.color} />
            <span className={`text-[11px] font-mono uppercase tracking-wide ${typeMeta.color}`}>{typeMeta.label}</span>
            <span className="text-[11px] font-mono text-parchment-faint">· #{listing.id}</span>
          </div>
          <h3 className="font-display font-semibold text-parchment leading-snug">{listing.title}</h3>
          <p className="text-sm text-parchment-muted mt-1 line-clamp-2">{listing.description}</p>
        </div>

        {/* What changes hands: barter shows item-for-item, sell/buy show the ETH price. */}
        <div className="flex items-stretch gap-2 rounded-lg bg-ink border border-ink-border p-2.5 text-xs">
          {isCashListing ? (
            <>
              <div className="flex-1 min-w-0">
                <p className="label mb-0.5">{listingType === 'buy' ? 'Offering' : 'Item'}</p>
                <p className="text-parchment truncate">{listingType === 'buy' ? price : listing.title}</p>
              </div>
              <div className="flex flex-col items-center justify-center px-1 shrink-0">
                <Lock size={13} className="text-copper" />
              </div>
              <div className="flex-1 min-w-0 text-right">
                <p className="label mb-0.5">{listingType === 'buy' ? 'Wanted' : 'Price'}</p>
                <p className="text-parchment truncate">{listingType === 'buy' ? listing.title : price}</p>
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <p className="label mb-0.5">Offering</p>
                <p className="text-parchment truncate">{listing.title}</p>
              </div>
              <div className="flex flex-col items-center justify-center px-1 shrink-0">
                <Lock size={13} className="text-copper" />
              </div>
              <div className="flex-1 min-w-0 text-right">
                <p className="label mb-0.5">Seeking</p>
                <p className="text-parchment truncate">{listing.seeking}</p>
              </div>
            </>
          )}
        </div>

        <p className="flex items-start gap-1.5 text-xs text-parchment-muted">
          <Lock size={12} className="text-copper shrink-0 mt-0.5" />
          <span>
            {listingType === 'barter' ? (
              <>
                Each side locks <span className="font-mono text-parchment">{formatBtk(listing.lockAmountBtk)}</span> +{' '}
                <span className="font-mono text-parchment">{formatEth(listing.priceEth)}</span>
              </>
            ) : (
              <>
                Each side locks <span className="font-mono text-parchment">{formatBtk(listing.lockAmountBtk)}</span>
                <span className="text-parchment-faint"> · the buyer also locks {formatEth(listing.priceEth)}</span>
              </>
            )}
          </span>
        </p>

        <div className="flex items-center justify-between pt-1 mt-auto">
          <Link
            to={`/reputation?address=${listing.owner}`}
            className="flex items-center gap-2 group/owner"
            title="View this trader's on-chain record"
          >
            {/* Ratings are private to the person who receives them: you never see your own. */}
            {!isOwn && (
              <ReputationBadge averageRating={listing.averageRating} ratingCount={listing.ratingCount} size={30} showLabel={false} />
            )}
            <span className="font-mono text-xs text-parchment-muted group-hover/owner:text-parchment">
              {isOwn ? 'You' : listing.ownerShort}
            </span>
          </Link>
          <span className="text-[11px] text-parchment-faint">{listing.createdAgo}</span>
        </div>

        {isOwn ? (
          <div className="flex items-center gap-2">
            <Link to="/trades" className="btn-secondary flex-1 justify-center !py-2 text-sm">
              {listing.pendingRequests > 0
                ? `${listing.pendingRequests} request${listing.pendingRequests === 1 ? '' : 's'}`
                : 'Your listing'}
            </Link>
            {listing.status === 'open' && (
              <button
                onClick={() => onDeactivate?.(listing)}
                className="btn-ghost border border-ink-border !py-2 text-sm"
                title="Close this listing"
              >
                <Power size={14} />
                Close
              </button>
            )}
          </div>
        ) : !canTrade ? (
          <p className="text-center text-xs text-parchment-faint rounded-lg border border-ink-border py-2.5">
            The admin does not trade
          </p>
        ) : (
          <button
            onClick={() => onRequestTrade?.(listing)}
            disabled={listing.status !== 'open'}
            className="w-full btn-secondary justify-between group/btn disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {listing.status === 'open' ? 'Request Trade' : listing.status === 'in_trade' ? 'Trade in progress' : 'Closed'}
            {listing.status === 'open' && (
              <ArrowRight size={15} className="transition-transform group-hover/btn:translate-x-0.5" />
            )}
          </button>
        )}
      </div>
    </div>
  )
}
