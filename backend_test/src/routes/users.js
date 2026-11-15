// src/routes/users.js
import { Router } from 'express'
import { body, param } from 'express-validator'
import { getUser, updateMe } from '../controllers/userController.js'
import { requireAuth } from '../middleware/auth.js'
import { handleImageUpload } from '../middleware/upload.js'
import { validate } from '../middleware/validate.js'

const router = Router()

router.get('/:address', param('address').matches(/^0x[a-fA-F0-9]{40}$/), validate, getUser)

router.put(
  '/me',
  requireAuth,
  handleImageUpload('avatar'),
  body('username').optional().trim().isLength({ max: 32 }),
  body('bio').optional().trim().isLength({ max: 280 }),
  validate,
  updateMe
)

export default router
