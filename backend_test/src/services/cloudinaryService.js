// src/services/cloudinaryService.js
//
// The only place that talks to Cloudinary. It has two jobs:
//   * store an already-verified image under a public_id the CALLER built from a checked
//     SHA-256 (never from client input), and
//   * turn Cloudinary's failures into ApiErrors the frontend can show.
//
// There is deliberately NO delete / replace function here. Photos are content-addressed
// (public_id = SHA-256 of the bytes), so one asset can be shared by several listings or
// requests that use the same file — deleting it for one would break the others.
import { getCloudinary, getImageFolder } from '../config/cloudinary.js'
import { ApiError } from '../utils/ApiError.js'

/** public_id of a listing / trade-request photo: "<folder>/<64 hex>". */
export function buildImagePublicId(hashHex) {
  return `${getImageFolder()}/${hashHex}`
}

/** public_id of a profile photo: "<folder>/avatars/<64 hex>". */
export function buildAvatarPublicId(hashHex) {
  return `${getImageFolder()}/avatars/${hashHex}`
}

/** Cloudinary rejects errors as plain objects ({ message, http_code }), not Error instances. */
export function mapCloudinaryError(err) {
  if (err instanceof ApiError) return err
  const code = Number(err?.http_code) || 0
  const text = `${err?.name ?? ''} ${err?.code ?? ''} ${err?.message ?? ''}`.toLowerCase()

  // Full detail stays in the server log; the browser only gets a short, safe sentence.
  console.error('[cloudinary] upload failed:', code || '-', err?.name || '', err?.message || err)

  if (code === 400 || text.includes('invalid image') || text.includes('format not allowed')) {
    return new ApiError(400, 'The image storage service could not accept this file. Try a different PNG, JPEG, WEBP or GIF.')
  }
  if (code === 401 || code === 403 || text.includes('invalid api_key') || text.includes('invalid signature')) {
    return new ApiError(502, 'The server could not authenticate with the image storage service. Please tell the site administrator.')
  }
  if (code === 420 || code === 429) {
    return new ApiError(503, 'The image storage service is busy or over its limit. Please try again in a few minutes.')
  }
  if (code === 499 || text.includes('timeout') || text.includes('etimedout')) {
    return new ApiError(504, 'The image storage service took too long to respond. Please try again.')
  }
  if (text.includes('enotfound') || text.includes('econnrefused') || text.includes('econnreset') || text.includes('eai_again')) {
    return new ApiError(502, 'The server could not reach the image storage service. Please try again shortly.')
  }
  return new ApiError(502, 'The image storage service failed. Please try again.')
}

/**
 * Uploads `buffer` — the original, untouched bytes — to Cloudinary as `publicId`.
 *
 *   overwrite: false      an existing asset is NEVER replaced. If the public_id is already
 *                         taken, Cloudinary answers with the existing asset (existing: true)
 *                         and nothing is written, which also makes retries and duplicate
 *                         clicks harmless.
 *   unique_filename: false / use_filename: false
 *                         the name is exactly `publicId`, never derived from the client's
 *                         file name, so there is no path manipulation and no random suffix.
 *   allowed_formats       a second, server-side check on top of our own magic-byte check.
 *   no `eager` / transformation options, so the stored original is byte-for-byte what was
 *   sent; any resizing happens at delivery time, in the URL.
 *
 * Only a Buffer can be passed: there is no code path that fetches a remote URL.
 *
 * Resolves { publicId, secureUrl, version, bytes, format, existing }.
 */
export async function uploadVerifiedImage({ buffer, publicId }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ApiError(400, 'No image data to upload.')

  const cloudinary = getCloudinary()
  if (!cloudinary) {
    throw new ApiError(
      503,
      'Image storage is not configured on the server (set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in backend_test/.env).'
    )
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: 'image',
          type: 'upload',
          overwrite: false,
          unique_filename: false,
          use_filename: false,
          invalidate: false,
          allowed_formats: ['png', 'jpg', 'webp', 'gif'],
          timeout: 60_000,
        },
        (error, res) => (error ? reject(error) : resolve(res))
      )
      stream.on('error', reject)
      stream.end(buffer)
    })

    if (!result?.secure_url || !result?.public_id) throw new Error('Cloudinary returned an unexpected response.')
    return {
      publicId: result.public_id,
      secureUrl: result.secure_url,
      version: result.version,
      bytes: result.bytes,
      format: result.format,
      existing: result.existing === true,
    }
  } catch (err) {
    throw mapCloudinaryError(err)
  }
}
