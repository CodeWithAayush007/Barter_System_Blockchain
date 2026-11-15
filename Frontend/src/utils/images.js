// src/utils/images.js
//
// Shared checks for the photos people attach to listings and trade requests.
// (The file itself goes to the backend; only its SHA-256 fingerprint goes on-chain.)

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Returns a readable problem with the file, or null when it is fine. */
export function imageProblem(file) {
  if (!file) return null
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Please choose a PNG, JPEG, WebP or GIF image.'
  if (file.size > MAX_IMAGE_BYTES) return 'Please choose an image under 5MB.'
  return null
}
