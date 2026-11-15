// src/utils/ApiError.js

// Thrown anywhere in a controller; caught by middleware/errorHandler.js
// so every error response has the same { error: { message, details } } shape.
export class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message)
    this.statusCode = statusCode
    this.details = details
  }
}
