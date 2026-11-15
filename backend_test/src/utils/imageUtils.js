// src/utils/imageUtils.js
//
// Small, dependency-free helpers for validating an uploaded image and naming it.
import crypto from 'crypto'

/**
 * The type of an image judged from its first bytes ("magic numbers") — NOT from the
 * file name or the Content-Type header, both of which the client controls.
 * Returns 'png' | 'jpg' | 'gif' | 'webp', or null if it is not one of those.
 */
export function sniffImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  const head6 = buf.subarray(0, 6).toString('latin1')
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif'
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  return null
}

/** SHA-256 of the exact bytes received, as 64 lowercase hex characters. */
export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/**
 * Turns an on-chain `imageHash` string into 64 lowercase hex characters, or null if it
 * is not a SHA-256 fingerprint. The chain accepts ANY string there (it only caps the
 * length), so this check is what stops a hostile value such as "../x" from ever being
 * used in a Cloudinary public_id.
 */
export function normalizeImageHash(value) {
  const m = /^(?:0x)?([0-9a-fA-F]{64})$/.exec(String(value ?? '').trim())
  return m ? m[1].toLowerCase() : null
}
