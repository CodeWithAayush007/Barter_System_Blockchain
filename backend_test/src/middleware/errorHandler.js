// src/middleware/errorHandler.js
import { ApiError } from '../utils/ApiError.js'

// 404 handler — mounted after all routes.
export function notFound(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`))
}

// Final error handler — mounted last. Normalizes Mongoose validation
// errors, duplicate-key errors, and our own ApiError instances into a
// single consistent JSON shape so the frontend can rely on it.
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  let statusCode = err instanceof ApiError ? err.statusCode : 500
  let message = err.message || 'Something went wrong.'
  let details = err instanceof ApiError ? err.details : null

  if (err.name === 'ValidationError') {
    statusCode = 400
    message = 'Validation failed.'
    details = Object.values(err.errors).map((e) => e.message)
  }

  if (err.code === 11000) {
    statusCode = 409
    const field = Object.keys(err.keyValue || {})[0] || 'field'
    message = `That ${field} is already in use.`
  }

  if (err.name === 'CastError') {
    statusCode = 400
    message = `Invalid ${err.path}: ${err.value}`
  }

  if (process.env.NODE_ENV !== 'production' && statusCode === 500) {
    console.error(err)
  }

  res.status(statusCode).json({
    error: {
      message,
      details,
    },
  })
}
