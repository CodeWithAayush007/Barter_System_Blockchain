// src/utils/errors.js

// Normalizes the many shapes an error can take here — MetaMask/ethers
// error objects, contract reverts, dropped RPC connections, and our own
// backend's JSON error bodies — into one readable string for the UI.

const CONTRACT_PREFIX = /^(BarterAgreement|Escrow|Reputation|BarterToken):\s*/i

// Custom errors thrown by OpenZeppelin that can surface through the Escrow.
const CUSTOM_ERRORS = {
  OwnableUnauthorizedAccount: 'Only the platform admin can do this.',
  ERC20InsufficientBalance: 'You don\'t have enough BTK for this.',
  ERC20InsufficientAllowance: 'The escrow isn\'t approved to lock that much BTK yet. Try again.',
  AccessControlUnauthorizedAccount: 'Your wallet isn\'t allowed to do this.',
  ReentrancyGuardReentrantCall: 'The contract is busy. Try again in a moment.',
}

// Friendlier wording for the reasons the contract gives most often (matched on the exact revert text).
const REVERT_TEXT = {
  'the admin cannot trade': 'The admin account cannot list or trade. Use a different wallet to trade.',
  'only the buyer confirms receipt': 'On a buy or sell trade only the buyer confirms that the item arrived.',
  'only the seller can ship': 'Only the seller can mark the item as shipped.',
  'already marked shipped': 'This trade is already marked as shipped.',
  'mark the item as shipped first': 'Mark the item as shipped before opening a dispute about a buyer who has not confirmed.',
  'buyer: item missing or wrong': 'As the buyer you can dispute an item that never arrived or is not as described.',
  'seller: buyer never confirmed': 'As the seller you can dispute a buyer who never confirmed receipt.',
  'trade not in escrow': 'This trade is not in escrow any more, so that is not possible now.',
  'cancellation already proposed': 'Someone has already proposed calling this trade off.',
  'cannot accept your own proposal': 'You proposed this yourself — the other side has to agree.',
  'no cancellation proposed': 'There is no proposal to call this trade off.',
  'photo required for sell listing': 'A sell listing needs a photo of the item.',
  'eth amount required': 'Enter an ETH amount greater than zero.',
  'incorrect eth amount sent': 'The ETH sent does not match what this trade requires. Refresh and try again.',
  'duplicate pending request': 'You already have a pending request on this listing.',
  'cannot trade with yourself': 'You cannot trade with yourself.',
  'listing not active': 'This listing is closed.',
  'active trade in progress': 'This listing has a trade in progress.',
  'no return is pending': 'There is no return waiting on this trade.',
  'only the buyer returns the item': 'Only the buyer marks the item as returned.',
  'only the seller confirms return': 'Only the seller confirms that the item came back.',
  'admin role cannot be renounced': 'The admin role cannot be given up.',
  'new admin must not be a trader': 'The new admin wallet must not have traded before.',
}

function tidyReason(reason) {
  const text = String(reason).replace(CONTRACT_PREFIX, '').trim()
  if (!text) return null
  const friendly = REVERT_TEXT[text.toLowerCase()]
  if (friendly) return friendly
  const sentence = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}

/**
 * Digs the human-readable revert reason out of an ethers / MetaMask / Hardhat
 * error. Different providers bury it in different places, so look in all of them.
 */
export function extractRevertReason(err) {
  if (!err) return null

  if (err.revert?.name && CUSTOM_ERRORS[err.revert.name]) return CUSTOM_ERRORS[err.revert.name]
  if (err.revert?.args?.[0] && typeof err.revert.args[0] === 'string') return tidyReason(err.revert.args[0])
  if (err.reason && typeof err.reason === 'string' && !/^execution reverted/i.test(err.reason)) {
    return tidyReason(err.reason)
  }

  const candidates = [
    err.shortMessage,
    err.message,
    err.info?.error?.message,
    err.error?.message,
    err.data?.message,
    err.info?.error?.data?.message,
  ].filter((m) => typeof m === 'string')

  for (const text of candidates) {
    const named = text.match(/(OwnableUnauthorizedAccount|ERC20InsufficientBalance|ERC20InsufficientAllowance|AccessControlUnauthorizedAccount)/)
    if (named) return CUSTOM_ERRORS[named[1]]
    const m = text.match(/reverted(?: with reason string)?:?\s*['"]?([^'"\n]+?)['"]?(?:\s*\(|$)/i)
    if (m && m[1] && !/^(unknown custom error|transaction reverted)/i.test(m[1].trim())) {
      return tidyReason(m[1])
    }
  }
  return null
}

export function parseError(err) {
  if (!err) return 'Something went wrong. Please try again.'

  const code = err.code
  const message = (err.reason || err.shortMessage || err.message || '').toLowerCase()

  // Our own pre-flight checks throw plain Errors with a readable message.
  if (err.userFacing) return err.message

  // User rejected the request in their wallet.
  if (code === 'ACTION_REJECTED' || code === 4001 || message.includes('user rejected') || message.includes('user denied')) {
    return 'Request was cancelled in your wallet.'
  }

  // Insufficient funds for value + gas.
  if (code === 'INSUFFICIENT_FUNDS' || message.includes('insufficient funds')) {
    return 'Your wallet doesn\'t have enough ETH to cover this transaction plus gas.'
  }

  // Wrong / unsupported network.
  if (message.includes('unsupported chain') || message.includes('chain mismatch') || message.includes('wrong network') || message.includes('network changed')) {
    return 'You\'re on the wrong network for this action. Switch networks and try again.'
  }

  // The wallet and the local node disagree about the account's transaction count. This is THE classic
  // "transaction failed" on a local Hardhat chain: every restart of the chain starts it from zero, while
  // MetaMask keeps counting from where the previous run stopped.
  const everything = [
    err.shortMessage,
    err.message,
    err.info?.error?.message,
    err.info?.error?.data?.message,
    err.error?.message,
    err.data?.message,
  ]
    .filter((m) => typeof m === 'string')
    .join(' ')
    .toLowerCase()
  if (
    code === 'NONCE_EXPIRED' ||
    /nonce (is )?too (low|high)|nonce has already been used|replacement transaction underpriced/.test(everything)
  ) {
    return 'MetaMask is out of step with the local blockchain (this happens after the chain was restarted). In MetaMask open Settings → Advanced → "Clear activity tab data" for this account, then try again.'
  }

  if (/too low for the next block|transaction underpriced|max fee per gas less than block base fee/.test(everything)) {
    return 'The network fee your wallet chose was too low for the current block. Try again (MetaMask will pick a fresh fee), or choose "Aggressive" in MetaMask\'s fee options.'
  }

  // Contract revert — surface the reason the contract gave.
  const revert = extractRevertReason(err)
  if (revert) return revert
  if (code === 'CALL_EXCEPTION') {
    if (message.includes('could not decode result data') || message.includes('bad_data')) {
      return 'No contract answered at the expected address. The local chain was probably restarted — run "npm run dev" in the project folder to deploy the contracts again, then refresh.'
    }
    return 'The transaction was rejected by the smart contract.'
  }

  // Dropped/unreachable RPC.
  if (code === 'NETWORK_ERROR' || code === 'SERVER_ERROR' || message.includes('failed to fetch') || message.includes('network error') || message.includes('econnrefused')) {
    return 'Couldn\'t reach the blockchain node. Is it running? Start everything with "npm run dev" in the project folder.'
  }

  if (code === 'TIMEOUT') {
    return 'The request timed out. Please try again.'
  }

  // Backend API error shape: { error: { message } }
  if (err.apiMessage) {
    return err.apiMessage
  }

  // Fall back to whatever readable text we have, capped so raw provider
  // dumps don't flood the UI.
  const fallback = err.reason || err.shortMessage || err.message
  if (fallback && fallback.length < 160) return fallback

  return 'Something went wrong. Please try again.'
}
