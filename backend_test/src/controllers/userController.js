// src/controllers/userController.js
import User from '../models/User.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { isCloudinaryConfigured } from '../config/cloudinary.js'
import { uploadVerifiedImage, buildAvatarPublicId } from '../services/cloudinaryService.js'
import { sha256Hex, sniffImageType } from '../utils/imageUtils.js'

// GET /api/users/:address
export const getUser = asyncHandler(async (req, res) => {
  const address = req.params.address.toLowerCase()
  const user = await User.findOne({ address }).select('-nonce -nonceExpiresAt')
  if (!user) throw new ApiError(404, 'User not found.')
  res.json(user)
})

// PUT /api/users/me  (auth required)
export const updateMe = asyncHandler(async (req, res) => {
  const { username, bio } = req.body
  const user = await User.findOne({ address: req.user.address })
  if (!user) throw new ApiError(404, 'User not found.')

  if (username !== undefined) user.username = username
  if (bio !== undefined) user.bio = bio
  if (req.file) {
    // Stored on Cloudinary like every other image. The name is the SHA-256 of the file, so a new
    // avatar never overwrites an old one (and the same picture is stored only once).
    if (!isCloudinaryConfigured()) {
      throw new ApiError(503, 'Image storage is not configured on the server (see CLOUDINARY_* in backend_test/.env).')
    }
    if (!sniffImageType(req.file.buffer)) throw new ApiError(400, 'That file is not a valid PNG, JPEG, WEBP or GIF image.')
    const stored = await uploadVerifiedImage({
      buffer: req.file.buffer,
      publicId: buildAvatarPublicId(sha256Hex(req.file.buffer)),
    })
    user.avatarUrl = stored.secureUrl
  }

  await user.save()
  res.json(user)
})
