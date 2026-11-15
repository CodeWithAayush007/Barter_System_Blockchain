// src/models/User.js
import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^0x[a-f0-9]{40}$/, 'Invalid Ethereum address'],
      index: true,
    },
    username: { type: String, trim: true, maxlength: 32, default: null },
    bio: { type: String, trim: true, maxlength: 280, default: '' },
    avatarUrl: { type: String, default: null },

    // Wallet-signature auth (see controllers/authController.js).
    // A fresh nonce is issued per login attempt and invalidated once used.
    nonce: { type: String, required: true },
    nonceExpiresAt: { type: Date, required: true },
  },
  { timestamps: true }
)

export default mongoose.model('User', userSchema)
