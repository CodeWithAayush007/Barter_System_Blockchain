// src/routes/auth.js
import { Router } from 'express'
import { param, body } from 'express-validator'
import { getNonce, verifySignature } from '../controllers/authController.js'
import { validate } from '../middleware/validate.js'

const router = Router()

router.get(
  '/nonce/:address',
  param('address').matches(/^0x[a-fA-F0-9]{40}$/).withMessage('Invalid Ethereum address.'),
  validate,
  getNonce
)

router.post(
  '/verify',
  body('address').matches(/^0x[a-fA-F0-9]{40}$/).withMessage('Invalid Ethereum address.'),
  body('signature').isString().isLength({ min: 10 }).withMessage('Invalid signature.'),
  validate,
  verifySignature
)

export default router
