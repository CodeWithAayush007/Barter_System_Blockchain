// src/routes/images.js
//
// Photo upload for listings and trade requests (the files live on Cloudinary; the
// blockchain keeps their SHA-256). There are intentionally no routes to read, edit or
// delete a photo: the frontend builds the Cloudinary URL from the on-chain hash, and
// replacing a photo means making a new listing / request with a new hash.
import { Router } from 'express'
import { body } from 'express-validator'
import { uploadListingImage, uploadRequestImage } from '../controllers/imageController.js'
import { requireAuth } from '../middleware/auth.js'
import { handleImageUpload } from '../middleware/upload.js'
import { validate } from '../middleware/validate.js'

const router = Router()

router.post(
  '/listings',
  requireAuth,
  handleImageUpload('image'),
  body('onChainListingId').isInt({ min: 1 }).withMessage('onChainListingId must be a positive integer.'),
  validate,
  uploadListingImage
)

router.post(
  '/requests',
  requireAuth,
  handleImageUpload('image'),
  body('onChainRequestId').isInt({ min: 1 }).withMessage('onChainRequestId must be a positive integer.'),
  validate,
  uploadRequestImage
)

export default router
