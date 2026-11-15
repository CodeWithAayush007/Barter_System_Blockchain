// src/utils/asyncHandler.js

// Wrap every async controller in this so a thrown/rejected error is
// forwarded to next() instead of crashing the process or hanging the
// request. Usage: router.get('/', asyncHandler(async (req, res) => {...}))
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
