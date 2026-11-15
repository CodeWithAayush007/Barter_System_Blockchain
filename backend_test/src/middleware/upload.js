// src/middleware/upload.js
//
// Receives a multipart image into MEMORY. Nothing is written to the server's disk: the
// controller hashes these exact bytes, compares the hash with the blockchain, and only
// then streams them to Cloudinary.
import multer from 'multer'
import { ApiError } from '../utils/ApiError.js'

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

// First, cheap filter on the declared Content-Type. It can be faked, so the controllers
// ALSO check the real file signature (utils/imageUtils.js → sniffImageType).
function fileFilter(req, file, cb) {
  if (!ALLOWED_TYPES.has(file.mimetype)) {
    return cb(new ApiError(400, 'Only PNG, JPEG, WEBP, or GIF images are allowed.'))
  }
  cb(null, true)
}

const maxSizeMb = Number(process.env.MAX_UPLOAD_MB || 5)

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  // One small file per request: the limits also cap how much a single request can hold in memory.
  limits: { fileSize: maxSizeMb * 1024 * 1024, files: 1, fields: 10, parts: 12 },
})

// Wraps multer's single-file middleware so oversize/type errors go
// through the same ApiError → errorHandler path as everything else.
export function handleImageUpload(fieldName) {
  const single = upload.single(fieldName)
  return (req, res, next) => {
    single(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new ApiError(400, `Image must be smaller than ${maxSizeMb}MB.`))
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(new ApiError(400, `Send exactly one image, in the "${fieldName}" field.`))
        }
        return next(new ApiError(400, err.message))
      }
      if (err) return next(err)
      next()
    })
  }
}
