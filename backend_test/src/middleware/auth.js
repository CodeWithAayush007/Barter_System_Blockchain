// src/middleware/auth.js
import jwt from 'jsonwebtoken'
import { ApiError } from '../utils/ApiError.js'

/**
 * Verifies the Bearer token issued by /api/auth/verify and attaches
 * { address } to req.user. Use on any route that writes data tied to
 * a specific wallet (creating listings, requesting trades, etc.).
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    return next(new ApiError(401, 'Missing or malformed Authorization header.'))
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.user = { address: payload.address }
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new ApiError(401, 'Session expired. Please sign in again.'))
    }
    return next(new ApiError(401, 'Invalid authentication token.'))
  }
}

/**
 * For routes writing/modifying a resource owned by an address in the
 * URL or body — ensures the authenticated wallet matches, so one
 * wallet can't edit another's listing just by guessing an ID.
 */
export function requireOwnership(getOwnerAddress) {
  return (req, res, next) => {
    const owner = getOwnerAddress(req)
    if (!owner || owner.toLowerCase() !== req.user.address.toLowerCase()) {
      return next(new ApiError(403, 'You do not have permission to modify this resource.'))
    }
    next()
  }
}
