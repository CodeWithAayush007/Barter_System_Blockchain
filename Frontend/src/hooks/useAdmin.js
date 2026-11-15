// src/hooks/useAdmin.js
import { useBarter } from './useBarter.jsx'
import { useAsyncData } from './useAsyncData'
import { loadListingImages } from '../utils/listingMeta'
import { loadRequestImages } from '../utils/requestMeta'

const NO_DISPUTES = { open: [], returns: [], history: [] }

/**
 * Whether the connected wallet is the platform admin (the owner of the
 * BarterAgreement contract — only that wallet can rule on disputes).
 *
 * The admin is a referee, not a trader: the contract refuses to let that wallet
 * list or request anything, and it has no reputation. So this hook is also what
 * the rest of the app uses to hide every trading screen from the admin.
 *
 * Pass `{ withDisputes: true }` (admin screens only) to also load:
 *   open     disputes waiting for a ruling
 *   returns  "not as described" rulings waiting for the item to come back
 *   history  every dispute that has been closed, newest first
 */
export function useAdmin({ withDisputes = false } = {}) {
  const { service, version, address } = useBarter()

  const { data, loading, error, refetch } = useAsyncData(
    async () => {
      if (!service) return { isAdmin: false, adminAddress: null, disputes: NO_DISPUTES }
      const adminAddress = await service.fetchAdminAddress()
      const isAdmin = !!address && adminAddress.toLowerCase() === address.toLowerCase()
      let disputes = NO_DISPUTES
      if (isAdmin && withDisputes) {
        const found = await service.fetchAdminDisputes()
        // The photos help the admin judge "not as described": the listing's photo and the one the requester attached.
        const all = [...found.open, ...found.returns, ...found.history]
        const [listingImages, requestImages] = await Promise.all([
          loadListingImages(all.map((c) => c.listing)),
          loadRequestImages(all.map((c) => c.request)),
        ])
        const withPhotos = (c) => ({
          ...c,
          listingPhotoUrl: listingImages.get(c.listing.id) ?? null,
          requestPhotoUrl: requestImages.get(c.request.id) ?? null,
        })
        disputes = { open: found.open.map(withPhotos), returns: found.returns.map(withPhotos), history: found.history.map(withPhotos) }
      }
      return { isAdmin, adminAddress, disputes }
    },
    [service, address, withDisputes],
    { refreshKey: version }
  )

  const disputes = data?.disputes ?? NO_DISPUTES
  return {
    isAdmin: data?.isAdmin ?? false,
    adminAddress: data?.adminAddress ?? null,
    disputes,
    // cases that need the admin to do something right now
    pendingCount: disputes.open.length + disputes.returns.length,
    loading,
    error,
    refetch,
  }
}
