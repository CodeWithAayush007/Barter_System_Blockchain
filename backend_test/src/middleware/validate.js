// src/middleware/validate.js
import { validationResult } from 'express-validator'
import { ApiError } from '../utils/ApiError.js'

// Drop this after a chain of express-validator checks in a route
// definition: [check(...), check(...), validate]
//
// Uploads are held in memory (see middleware/upload.js), so a rejected request leaves
// nothing behind that needs cleaning up.
export function validate(req, res, next) {
  const result = validationResult(req)
  if (!result.isEmpty()) {
    const details = result.array().map((e) => `${e.path}: ${e.msg}`)
    return next(new ApiError(400, 'Validation failed.', details))
  }
  next()
}
