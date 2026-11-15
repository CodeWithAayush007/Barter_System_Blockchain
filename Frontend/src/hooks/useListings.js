// src/hooks/useListings.js
import { useMemo } from 'react'
import { useBarter } from './useBarter.jsx'
import { useAsyncData } from './useAsyncData'
import { shortenAddress } from '../blockchain/provider'
import { unixAgo } from '../utils/format'
import { placeholderImage } from '../utils/placeholder'
import { loadListingImages } from '../utils/listingMeta'

function toViewModel(listing, imageMap, repMap) {
  const rep = repMap.get(listing.ownerLower) ?? { averageRating: 0, ratingCount: 0 }
  return {
    ...listing,
    ownerShort: shortenAddress(listing.owner),
    image: imageMap.get(listing.id) || placeholderImage(listing.listingType),
    hasPhoto: imageMap.has(listing.id),
    averageRating: rep.averageRating,
    ratingCount: rep.ratingCount,
    createdAgo: unixAgo(listing.createdAt),
  }
}

/**
 * Every listing comes straight from BarterAgreement on the chain: owner, type,
 * price, lock amount, status. The photo URL (a file the blockchain can't hold) is
 * derived from the on-chain image hash and points at Cloudinary; a missing photo
 * just shows a placeholder. The chain is re-read after every transaction and every few
 * seconds, so a trade started by someone else shows up on its own.
 *
 * Filtering is done here, client-side, over what the chain returned.
 */
export function useListings({ search = '', category = 'all', type = 'all', status = 'open' } = {}) {
  const { service, version } = useBarter()

  const { data, loading, error, refetch } = useAsyncData(
    async () => {
      if (!service) return []
      const all = await service.fetchListings()
      const [imageMap, repMap] = await Promise.all([
        loadListingImages(all),
        service.fetchReputations(all.map((l) => l.owner)),
      ])
      return all.map((l) => toViewModel(l, imageMap, repMap))
    },
    [service],
    { refreshKey: version }
  )

  const all = data ?? []

  const listings = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter((l) => {
      if (category !== 'all' && l.category !== category) return false
      if (type !== 'all' && l.listingType !== type) return false
      if (status !== 'all' && l.status !== status) return false
      if (q) {
        const haystack = `${l.title} ${l.description} ${l.seeking} ${l.category}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [all, search, category, type, status])

  return { listings, allListings: all, loading, error, refetch }
}
