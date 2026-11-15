// src/config/cloudinary.js
//
// Cloudinary is the file store for listing photos, trade-request photos and avatars.
// The API secret lives ONLY here, in the backend environment — it is never sent to the
// browser and has no VITE_ twin.
//
// The SDK is configured lazily (on first use) so that dotenv has already run, and so a
// missing configuration only disables uploads instead of stopping the whole API.
import { v2 as cloudinary } from 'cloudinary'

// Folder (public_id prefix) everything is stored under. Change it per environment if you
// share one Cloudinary account (e.g. "trove-dev" / "trove-prod"). The frontend must use
// the same value (VITE_CLOUDINARY_FOLDER).
const FOLDER_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/

export function getImageFolder() {
  const folder = (process.env.CLOUDINARY_FOLDER || 'trove').trim().replace(/^\/+|\/+$/g, '')
  if (!FOLDER_PATTERN.test(folder)) {
    throw new Error('CLOUDINARY_FOLDER may only contain letters, digits, "-", "_" and "/" between segments.')
  }
  return folder
}

export function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
  )
}

let configured = false

/** Returns the configured SDK, or null when the three CLOUDINARY_* variables are not all set. */
export function getCloudinary() {
  if (!isCloudinaryConfigured()) return null
  if (!configured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true, // always hand out https:// URLs
    })
    configured = true
  }
  return cloudinary
}
