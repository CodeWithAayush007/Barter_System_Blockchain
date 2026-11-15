// src/models/Activity.js
//
// A readable activity feed. Every row is derived from an event read out of a
// MINED transaction on the chain (see controllers/activityController.js), so
// the feed is a convenience cache of things that really happened — it is not a
// record anyone can write to directly.
import mongoose from 'mongoose'

const activitySchema = new mongoose.Schema(
  {
    user: {
      type: String,
      required: true,
      lowercase: true,
      match: [/^0x[a-f0-9]{40}$/, 'Invalid Ethereum address'],
      index: true,
    },
    type: {
      type: String,
      enum: [
        'listing_created',
        'trade_requested',
        'trade_accepted',
        'trade_rejected',
        'trade_cancelled',
        'trade_confirmed',
        'trade_rated',
        'trade_completed',
        'trade_shipped',
        'trade_cancel_proposed',
        'trade_cancel_cleared',
        'trade_cancelled_in_escrow',
        'trade_disputed',
        'return_requested',
        'return_marked',
        'dispute_resolved',
      ],
      required: true,
    },
    message: { type: String, required: true, maxlength: 300 },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false },

    // Which log of which transaction this row came from — makes syncing the
    // same transaction twice a no-op.
    txHash: { type: String, required: true, lowercase: true },
    logIndex: { type: Number, required: true },
  },
  { timestamps: true }
)

activitySchema.index({ user: 1, createdAt: -1 })
activitySchema.index({ txHash: 1, logIndex: 1, user: 1 }, { unique: true })

export default mongoose.model('Activity', activitySchema)
