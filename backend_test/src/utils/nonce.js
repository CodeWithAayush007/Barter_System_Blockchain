// src/utils/nonce.js
import crypto from 'crypto'

export function generateNonce() {
  return crypto.randomBytes(16).toString('hex')
}

export function nonceExpiry() {
  const minutes = Number(process.env.NONCE_TTL_MINUTES || 10)
  return new Date(Date.now() + minutes * 60 * 1000)
}

export function buildSignMessage(address, nonce) {
  return (
    `Trove wants you to sign in with your Ethereum account:\n${address}\n\n` +
    `This request will not trigger a blockchain transaction or cost any gas.\n\n` +
    `Nonce: ${nonce}`
  )
}
