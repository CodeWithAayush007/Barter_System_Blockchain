// src/controllers/imageController.js
//
// Photo uploads for listings and trade requests. The blockchain is the only authority:
// it says who may upload (the listing's owner / the request's requester) and which file
// is the right one (the SHA-256 recorded on-chain). Nothing the client sends — a hash, a
// URL, an owner address — is believed; the client only sends an id and the file.
//
//   1. requireAuth        → the wallet that signed in (JWT)
//   2. multer             → the file, in memory, size/type-limited
//   3. read the record from the chain; the signed-in wallet must be its owner/requester
//   4. the on-chain imageHash must be a well-formed SHA-256
//   5. the file's magic bytes must be PNG / JPEG / GIF / WEBP
//   6. sha256(received bytes) must equal the on-chain imageHash        ← integrity check
//   7. upload to Cloudinary as "<folder>/<hash>" with overwrite:false
//
// There are no routes that edit or delete an image, and no MongoDB involved.
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { readChainListing, readChainRequest } from '../chain/client.js'
import { isCloudinaryConfigured } from '../config/cloudinary.js'
import { uploadVerifiedImage, buildImagePublicId } from '../services/cloudinaryService.js'
import { normalizeImageHash, sha256Hex, sniffImageType } from '../utils/imageUtils.js'

/** Steps 4–7. `what` is "listing" or "trade request", used only in messages. */
async function verifyAndStore({ file, onChainHash, what }) {
  const expected = normalizeImageHash(onChainHash)
  if (!expected) {
    throw new ApiError(
      400,
      `This ${what} has no valid image fingerprint recorded on-chain, so no photo can be attached to it.`
    )
  }

  if (!sniffImageType(file.buffer)) {
    throw new ApiError(400, 'That file is not a valid PNG, JPEG, WEBP or GIF image.')
  }

  const actual = sha256Hex(file.buffer)
  if (actual !== expected) {
    throw new ApiError(
      400,
      `The uploaded file does not match the image hash recorded on-chain for this ${what}. Choose the exact file you picked when you created it.`
    )
  }

  const stored = await uploadVerifiedImage({ buffer: file.buffer, publicId: buildImagePublicId(expected) })
  return { stored, imageHash: `0x${expected}` }
}

function respond(res, { stored, imageHash }) {
  // 201 = newly stored, 200 = this exact image was already there (a retry, or the same file reused).
  res.status(stored.existing ? 200 : 201).json({
    imageHash,
    publicId: stored.publicId,
    secureUrl: stored.secureUrl,
    existing: stored.existing,
  })
}

function requireConfigured() {
  if (!isCloudinaryConfigured()) {
    throw new ApiError(
      503,
      'Image storage is not configured on the server (set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in backend_test/.env).'
    )
  }
}

// POST /api/images/listings  (auth required, multipart: onChainListingId + image)
export const uploadListingImage = asyncHandler(async (req, res) => {
  requireConfigured()
  const onChainListingId = Number(req.body.onChainListingId)
  if (!req.file) throw new ApiError(400, 'An image file is required (field "image").')

  const chain = await readChainListing(onChainListingId)
  if (!chain) throw new ApiError(404, 'That listing does not exist on the blockchain.')
  if (chain.owner !== req.user.address) {
    throw new ApiError(403, 'Only the on-chain owner of a listing can attach its photo.')
  }

  respond(res, await verifyAndStore({ file: req.file, onChainHash: chain.imageHash, what: 'listing' }))
})

// POST /api/images/requests  (auth required, multipart: onChainRequestId + image)
export const uploadRequestImage = asyncHandler(async (req, res) => {
  requireConfigured()
  const onChainRequestId = Number(req.body.onChainRequestId)
  if (!req.file) throw new ApiError(400, 'An image file is required (field "image").')

  const chain = await readChainRequest(onChainRequestId)
  if (!chain) throw new ApiError(404, 'That trade request does not exist on the blockchain.')
  if (chain.requester !== req.user.address) {
    throw new ApiError(403, 'Only the on-chain requester of a trade can attach its photo.')
  }

  respond(res, await verifyAndStore({ file: req.file, onChainHash: chain.imageHash, what: 'trade request' }))
})
