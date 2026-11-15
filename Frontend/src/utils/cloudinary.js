// src/utils/cloudinary.js
//
// Where a photo lives, worked out from the blockchain alone.
//
// The contract stores each photo's SHA-256 (`imageHash`). The backend uploads the file to
// Cloudinary under the public_id "<folder>/<that hash, 64 hex chars>" — and only after
// proving the file really has that hash — so the delivery URL can be built here, with no
// call to the backend and no id → URL lookup table:
//
//   https://res.cloudinary.com/<cloud name>/image/upload/<transforms>/<folder>/<hash>
//
// Because the name is the hash of the *bytes*, not a listing or request number, a local
// Hardhat reset can never attach an old photo to a new listing: listing #1 on the new chain
// has a different hash (unless its owner really committed the same file) and therefore a
// different URL.
//
// Only the cloud name is needed here. It is public (it is in every image URL). The API key and
// secret stay in backend_test/.env and are never sent to the browser.

import { apiFetch } from './api'
import { parseError } from './errors'

const CLOUD_NAME = String(import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '').trim()
const FOLDER = String(import.meta.env.VITE_CLOUDINARY_FOLDER || 'trove').trim().replace(/^\/+|\/+$/g, '')
// Delivery-time transformations (the stored original is never altered). Set to "" to serve the original as-is.
const TRANSFORM = String(import.meta.env.VITE_CLOUDINARY_TRANSFORM ?? 'f_auto,q_auto').trim()

// Everything that ends up inside a URL path is validated, so a bad env value or a hostile
// on-chain string can never turn into a different URL.
const CLOUD_RE = /^[A-Za-z0-9_-]+$/
const FOLDER_RE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/
const TRANSFORM_RE = /^[A-Za-z0-9_,.:-]*$/

export const isImageStorageConfigured = CLOUD_RE.test(CLOUD_NAME) && FOLDER_RE.test(FOLDER) && TRANSFORM_RE.test(TRANSFORM)

if (!isImageStorageConfigured && import.meta.env.DEV) {
  console.warn(
    '[images] Set VITE_CLOUDINARY_CLOUD_NAME in Frontend/.env (and restart `npm run dev`) so listing and trade photos can be shown.'
  )
}

/** 64 lowercase hex chars from an on-chain imageHash ("0x…" or bare), or null if it is not a SHA-256. */
export function normalizeImageHash(value) {
  const m = /^(?:0x)?([0-9a-fA-F]{64})$/.exec(String(value ?? '').trim())
  return m ? m[1].toLowerCase() : null
}

// hash → versioned URL of an image uploaded in this browser session. Keyed by the content hash,
// never by a listing/request id, so it cannot go stale when a local chain is reset.
const uploaded = new Map()

function withTransform(url) {
  return TRANSFORM ? url.replace('/image/upload/', `/image/upload/${TRANSFORM}/`) : url
}

/**
 * Call right after a successful upload with the response's `imageHash` and `secureUrl`.
 * The URL is used only if it really points at our Cloudinary cloud over https.
 */
export function rememberUploadedImage(imageHash, secureUrl) {
  const hex = normalizeImageHash(imageHash)
  if (!hex || !secureUrl) return
  try {
    const u = new URL(secureUrl)
    const ours = u.protocol === 'https:' && u.hostname === 'res.cloudinary.com' && (!CLOUD_NAME || u.pathname.startsWith(`/${CLOUD_NAME}/`))
    if (ours) uploaded.set(hex, withTransform(u.origin + u.pathname))
  } catch {
    /* ignore a malformed URL — the derived one is used instead */
  }
}

/**
 * The image URL for an on-chain imageHash, or null when there is no (valid) hash, or
 * Cloudinary is not configured for this frontend.
 */
export function imageUrlForHash(imageHash) {
  const hex = normalizeImageHash(imageHash)
  if (!hex) return null
  const fresh = uploaded.get(hex)
  if (fresh) return fresh
  if (!isImageStorageConfigured) return null
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${TRANSFORM ? `${TRANSFORM}/` : ''}${FOLDER}/${hex}`
}

/**
 * Sends the original file to the backend, which checks the wallet and the on-chain hash and
 * then stores it on Cloudinary. `kind` is 'listings' or 'requests'.
 * Returns null on success, or a readable error message.
 */
export async function uploadPhoto(kind, id, file) {
  const field = kind === 'listings' ? 'onChainListingId' : 'onChainRequestId'
  const body = new FormData()
  body.append(field, String(id))
  body.append('image', file)
  try {
    const res = await apiFetch(`/images/${kind}`, { method: 'POST', body, formData: true })
    rememberUploadedImage(res?.imageHash, res?.secureUrl)
    return null
  } catch (err) {
    return parseError(err)
  }
}
