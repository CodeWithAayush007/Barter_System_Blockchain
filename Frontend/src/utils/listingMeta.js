// src/utils/listingMeta.js
//
// Listing *photos* are the one thing about a listing the blockchain does not store (it stores
// a SHA-256 fingerprint of the photo instead). The file itself is on Cloudinary, under a name
// derived from that fingerprint — see utils/cloudinary.js. Nothing here asks the backend where
// a photo is, and nothing is remembered by listing id.

import { imageUrlForHash, uploadPhoto } from './cloudinary'

/** Computes the SHA-256 of a File as "0x…" — the value committed on-chain as the listing's imageHash. */
export async function hashImageFile(file) {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `0x${hex}`
}

/**
 * Uploads the photo for a listing that already exists on-chain (the backend checks that you own
 * it and that the file matches the on-chain hash). Returns null on success, or a readable error.
 */
export function uploadListingPhoto(listingId, file) {
  return uploadPhoto('listings', listingId, file)
}

/**
 * Map(listingId → image URL) for every listing whose on-chain hash is a valid fingerprint.
 * Built fresh from the chain data passed in on every call — never cached by listing id, so a
 * reset local chain can't show an old listing's picture. (The cards fall back to a placeholder
 * if the file turns out not to be on Cloudinary.)
 */
export function loadListingImages(listings) {
  const images = new Map()
  for (const l of listings) {
    const url = imageUrlForHash(l.imageHash)
    if (url) images.set(l.id, url)
  }
  return images
}
