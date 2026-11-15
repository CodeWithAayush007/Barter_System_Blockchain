// src/controllers/authController.js
import { verifyMessage } from 'ethers'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { generateNonce, nonceExpiry, buildSignMessage } from '../utils/nonce.js'

// Step 1 — client asks for a nonce to sign with MetaMask.
// GET /api/auth/nonce/:address
export const getNonce = asyncHandler(async (req, res) => {
  const address = req.params.address.toLowerCase()

  let user = await User.findOne({ address })
  const nonce = generateNonce()

  if (!user) {
    user = await User.create({ address, nonce, nonceExpiresAt: nonceExpiry() })
  } else {
    user.nonce = nonce
    user.nonceExpiresAt = nonceExpiry()
    await user.save()
  }

  res.json({ message: buildSignMessage(address, nonce) })
})

// Step 2 — client posts back the signature; we recover the signing
// address and confirm it matches, then issue a JWT.
// POST /api/auth/verify  { address, signature }
export const verifySignature = asyncHandler(async (req, res) => {
  const { address, signature } = req.body
  if (!address || !signature) {
    throw new ApiError(400, 'address and signature are required.')
  }

  const normalized = address.toLowerCase()
  const user = await User.findOne({ address: normalized })
  if (!user) {
    throw new ApiError(400, 'No pending sign-in request for this address. Request a nonce first.')
  }

  if (user.nonceExpiresAt < new Date()) {
    throw new ApiError(401, 'Sign-in request expired. Please try again.')
  }

  const expectedMessage = buildSignMessage(normalized, user.nonce)

  let recovered
  try {
    recovered = verifyMessage(expectedMessage, signature)
  } catch {
    throw new ApiError(401, 'Malformed signature.')
  }

  if (recovered.toLowerCase() !== normalized) {
    throw new ApiError(401, 'Signature does not match the claimed address.')
  }

  // Invalidate the nonce immediately so the signature can't be replayed.
  user.nonce = generateNonce()
  user.nonceExpiresAt = new Date(0)
  await user.save()

  const token = jwt.sign({ address: normalized }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })

  res.json({
    token,
    user: {
      address: user.address,
      username: user.username,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
    },
  })
})
