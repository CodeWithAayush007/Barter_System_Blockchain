// src/routes/activity.js
import { Router } from 'express'
import { body, param } from 'express-validator'
import { getActivity, markRead, syncActivity } from '../controllers/activityController.js'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'

const router = Router()

router.get('/:address', param('address').matches(/^0x[a-fA-F0-9]{40}$/), validate, getActivity)

// Records the events of a mined transaction (verified against the chain).
router.post(
  '/sync',
  body('txHash').matches(/^0x[a-fA-F0-9]{64}$/).withMessage('txHash must be a 32-byte hex string.'),
  validate,
  syncActivity
)

router.patch('/:id/read', requireAuth, param('id').isMongoId(), validate, markRead)

export default router
