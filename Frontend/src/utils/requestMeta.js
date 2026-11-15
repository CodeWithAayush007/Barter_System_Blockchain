// src/utils/requestMeta.js
//
// The photo a requester attaches to a trade request ("here is what I'm offering, and this is its
// condition"). Like listing photos, the blockchain stores only the SHA-256 fingerprint
// (TradeRequest.imageHash); the file is on Cloudinary under a name derived from it, and the
// backend only accepts the upload from the on-chain requester if it matches that fingerprint.

import { imageUrlForHash, uploadPhoto } from './cloudinary'

/**
 * Uploads the photo for a request that already exists on-chain.
 * Returns null on success, or a readable error message.
 */
export function uploadRequestPhoto(requestId, file) {
  return uploadPhoto('requests', requestId, file)
}

/** Map(requestId → image URL) for every request whose on-chain hash is a valid fingerprint. Built fresh each call. */
export function loadRequestImages(requests) {
  const images = new Map()
  for (const r of requests) {
    const url = imageUrlForHash(r.imageHash)
    if (url) images.set(r.id, url)
  }
  return images
}
