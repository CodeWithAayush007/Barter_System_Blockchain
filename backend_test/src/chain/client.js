// src/chain/client.js
//
// The backend's read-only window onto the blockchain. It is used to VERIFY
// claims before storing anything — e.g. "this wallet owns on-chain listing #7
// and this photo is the one whose fingerprint is recorded there" — and to turn
// mined transactions into activity-feed entries. It never sends transactions
// and never decides anything about a trade itself.
//
// Addresses and the ABI are written here by Blockchain/scripts/deploy.js
// (src/chain/deployed.json + src/chain/abi.json), so after `npm run deploy:local`
// there is nothing to configure. Override with env vars if needed:
//   CHAIN_RPC_URL      default http://127.0.0.1:8545
//   AGREEMENT_ADDRESS  default: the address in src/chain/deployed.json

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Contract, Interface, JsonRpcProvider, ZeroAddress, formatEther, formatUnits } from 'ethers'
import { ApiError } from '../utils/ApiError.js'

const here = path.dirname(fileURLToPath(import.meta.url))

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'))
  } catch {
    return fallback
  }
}

// deployed.json is re-read on every call (it is tiny), so a fresh
// `npm run deploy:local` — or starting the API before the contracts exist — never
// leaves the backend pointing at a stale address. The ABI is cached once found.
let abiCache = null
function getAbi() {
  if (!abiCache || abiCache.length === 0) abiCache = readJson('abi.json', [])
  return abiCache
}
const getDeployed = () => readJson('deployed.json', {})

export const LISTING_TYPE_NAMES = ['barter', 'sell', 'buy']
export const TRADE_STATUS_NAMES = [
  'pending',
  'in_escrow',
  'awaiting_ratings',
  'completed',
  'rejected',
  'cancelled',
  'disputed',
  'resolved',
  'return_pending',
  'cancelled_in_escrow',
]

export function getRpcUrl() {
  return process.env.CHAIN_RPC_URL || 'http://127.0.0.1:8545'
}

export function getAgreementAddress() {
  return process.env.AGREEMENT_ADDRESS || getDeployed().BarterAgreement || null
}

export function getInterface() {
  return new Interface(getAbi())
}

let cached = null

/** Lazily builds the provider + BarterAgreement contract (read-only). */
export function getChain() {
  const address = getAgreementAddress()
  const abi = getAbi()
  if (!address || abi.length === 0) {
    throw new ApiError(
      503,
      'The backend does not know where the BarterAgreement contract is. Run "npm run deploy:local" in the Blockchain folder (it writes src/chain/deployed.json).'
    )
  }
  if (!cached || cached.address !== address || cached.rpcUrl !== getRpcUrl()) {
    const deployed = getDeployed()
    const chainId = deployed.chainId ? Number(BigInt(deployed.chainId)) : undefined
    const provider = new JsonRpcProvider(getRpcUrl(), chainId, {
      // With a known chain id the provider doesn't poll the node just to find
      // out which network it is — and a stopped node can't spam the logs.
      staticNetwork: chainId !== undefined,
      cacheTimeout: -1,
    })
    cached = {
      address,
      rpcUrl: getRpcUrl(),
      provider,
      agreement: new Contract(address, abi, provider),
      iface: new Interface(abi),
    }
  }
  return cached
}

/** Turns "node unreachable" style failures into a clean 503. */
export function asChainError(err) {
  if (err instanceof ApiError) return err
  const text = `${err?.code ?? ''} ${err?.shortMessage ?? ''} ${err?.message ?? ''}`.toLowerCase()
  if (
    text.includes('econnrefused') ||
    text.includes('network_error') ||
    text.includes('server_error') ||
    text.includes('timeout') ||
    text.includes('failed to detect network') ||
    text.includes('could not decode result data') ||
    text.includes('bad_data')
  ) {
    return new ApiError(
      503,
      `Could not read the blockchain at ${getRpcUrl()}. Is the node running and the contracts deployed?`
    )
  }
  return err
}

export function normalizeChainListing(l) {
  return {
    id: Number(l.id),
    owner: String(l.owner).toLowerCase(),
    listingType: LISTING_TYPE_NAMES[Number(l.listingType)],
    title: l.itemName,
    description: l.description,
    category: l.category,
    seeking: l.wantedItem,
    imageHash: String(l.imageHash || ''),
    priceEth: formatEther(l.price),
    lockAmountBtk: formatUnits(l.lockAmount, 18),
    active: !!l.active,
    createdAt: Number(l.createdAt),
  }
}

/** Reads one listing from the chain. Returns null if there is no such listing. */
export async function readChainListing(id) {
  try {
    const { agreement } = getChain()
    const next = await agreement.nextListingId()
    if (!Number.isInteger(id) || id < 1 || BigInt(id) >= next) return null
    const [raw] = await agreement.getListingsBatch([id])
    if (!raw || raw.owner === ZeroAddress) return null
    return normalizeChainListing(raw)
  } catch (err) {
    throw asChainError(err)
  }
}

export function normalizeChainRequest(r) {
  return {
    id: Number(r.id),
    listingId: Number(r.listingId),
    requester: String(r.requester).toLowerCase(),
    offeredItem: r.offeredItem,
    // SHA-256 of the photo of the offered item, committed on-chain by the requester ("" = no photo).
    imageHash: String(r.imageHash || ''),
    status: TRADE_STATUS_NAMES[Number(r.status)],
    createdAt: Number(r.createdAt),
  }
}

/** Reads one trade request from the chain. Returns null if there is no such request. */
export async function readChainRequest(id) {
  try {
    const { agreement } = getChain()
    const next = await agreement.nextRequestId()
    if (!Number.isInteger(id) || id < 1 || BigInt(id) >= next) return null
    const [raw] = await agreement.getRequestsBatch([id])
    if (!raw || raw.requester === ZeroAddress) return null
    return normalizeChainRequest(raw)
  } catch (err) {
    throw asChainError(err)
  }
}
