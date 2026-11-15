// src/utils/validation.js
import { isAddress } from 'ethers'

// Strips angle brackets and trims — belt-and-suspenders against stray
// markup in free-text fields. React already escapes on render, so this
// is mainly about keeping stored/submitted data clean, not XSS-proofing
// React itself.
export function sanitizeText(value = '') {
  return value.replace(/[<>]/g, '').trim()
}

export function isValidAddress(value) {
  try {
    return isAddress(value)
  } catch {
    return false
  }
}

export function isPositiveNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0
}

export function isNonNegativeNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0
}

/** More than 18 decimals can't be turned into wei / BTK-wei. */
export function hasTooManyDecimals(value, max = 18) {
  const [, decimals = ''] = String(value).split('.')
  return decimals.length > max
}

/**
 * Validates the Create Listing form. `form.listingType` is one of
 * 'barter' | 'sell' | 'buy' — which fields are required depends on it,
 * mirroring BarterAgreement.createListing()'s own checks.
 * `minLock` is the platform's current minimum lock amount (BTK), read from the
 * contract. Returns a { field: message } map — empty object means valid.
 */
export function validateListingForm(form, { minLock = 1, hasPhoto = false } = {}) {
  const errors = {}

  if (!['barter', 'sell', 'buy'].includes(form.listingType)) {
    errors.listingType = 'Choose barter, sell or buy.'
  }

  const title = sanitizeText(form.title)
  if (title.length < 3 || title.length > 100) {
    errors.title = 'Title must be 3–100 characters.'
  }

  const description = sanitizeText(form.description)
  if (description.length < 10 || description.length > 1000) {
    errors.description = 'Description must be 10–1000 characters.'
  }

  if (form.listingType === 'barter') {
    const seeking = sanitizeText(form.exchange)
    if (seeking.length < 2 || seeking.length > 200) {
      errors.exchange = 'Tell traders what you\'re looking for (2–200 characters).'
    }
  }

  // Y (ETH) is required on EVERY listing: the price on a sell/buy, the deposit each side locks on a barter.
  if (!isPositiveNumber(form.price)) {
    errors.price = form.listingType === 'barter' ? 'Enter an ETH stake greater than 0.' : 'Enter a price greater than 0 ETH.'
  } else if (Number(form.price) > 1000) {
    errors.price = 'That amount looks unusually high — double check it.'
  } else if (hasTooManyDecimals(form.price)) {
    errors.price = 'Use at most 18 decimal places.'
  }

  // A sell listing must show the item.
  if (form.listingType === 'sell' && !hasPhoto) {
    errors.image = 'A sell listing needs a photo of the item.'
  }

  if (!isPositiveNumber(form.lockAmount)) {
    errors.lockAmount = 'Enter the BTK each side will lock.'
  } else if (Number(form.lockAmount) < Number(minLock)) {
    errors.lockAmount = `The platform minimum is ${minLock} BTK.`
  } else if (Number(form.lockAmount) > 1_000_000) {
    errors.lockAmount = 'That lock amount is unusually high — double check it.'
  } else if (hasTooManyDecimals(form.lockAmount)) {
    errors.lockAmount = 'Use at most 18 decimal places.'
  }

  return errors
}

/**
 * Validates the "request this trade" form. The contract requires an offered
 * item for barter and buy listings; for a sell listing the requester is simply
 * paying, so it is optional.
 */
export function validateTradeRequestForm(form, listingType) {
  const errors = {}
  const item = sanitizeText(form.offeredItem)
  if (listingType !== 'sell' && item.length < 2) {
    errors.offeredItem = listingType === 'buy'
      ? 'Say what you are selling to this buyer.'
      : 'Say what you are offering in exchange.'
  }
  if (item.length > 100) errors.offeredItem = 'Keep it under 100 characters.'
  if (sanitizeText(form.offeredDescription).length > 500) {
    errors.offeredDescription = 'Keep the description under 500 characters.'
  }
  return errors
}

/**
 * Validates the token transfer form.
 */
export function validateTransferForm({ recipient, amount }, senderAddress) {
  const errors = {}

  if (!isValidAddress(recipient)) {
    errors.recipient = 'Enter a valid Ethereum address.'
  } else if (senderAddress && recipient.toLowerCase() === senderAddress.toLowerCase()) {
    errors.recipient = 'You cannot send tokens to yourself.'
  }

  if (!isPositiveNumber(amount)) {
    errors.amount = 'Enter an amount greater than 0.'
  } else if (hasTooManyDecimals(amount)) {
    errors.amount = 'Use at most 18 decimal places.'
  }

  return errors
}

export function hasErrors(errorMap) {
  return Object.keys(errorMap).length > 0
}
