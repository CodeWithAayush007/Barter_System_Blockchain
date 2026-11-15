// src/blockchain/provider.js
//
// Central place for anything that talks to an Ethereum-style wallet or node.
// Every other blockchain file (contract.js, hooks/useWallet.jsx) should
// import from here instead of calling `window.ethereum` directly, so
// swapping ethers versions or adding WalletConnect later only touches
// this file.

import { BrowserProvider, JsonRpcProvider } from 'ethers'
import { NETWORKS, DEFAULT_CHAIN_ID, isDeployedOn } from './networks'

export function hasInjectedWallet() {
  return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined'
}

/**
 * Returns an ethers v6 BrowserProvider wrapping window.ethereum.
 * Throws a readable error if no wallet extension is present.
 */
export function getBrowserProvider() {
  if (!hasInjectedWallet()) {
    throw new Error('No wallet found. Install MetaMask to continue.')
  }
  // cacheTimeout -1: ethers otherwise caches identical read calls for 250 ms,
  // which can show a balance from *before* the transaction that just mined.
  return new BrowserProvider(window.ethereum, undefined, { cacheTimeout: -1 })
}

const readProviders = new Map()

/**
 * A read-only provider that talks straight to the chain's RPC node, with no
 * wallet involved. This is what lets the marketplace show real on-chain
 * listings before anyone has connected MetaMask.
 */
export function getReadProvider(chainId = DEFAULT_CHAIN_ID) {
  const network = NETWORKS[chainId]
  if (!network?.rpcUrl) {
    throw new Error(`No RPC URL configured for chain ${chainId}.`)
  }
  if (!readProviders.has(chainId)) {
    readProviders.set(
      chainId,
      new JsonRpcProvider(network.rpcUrl, parseInt(chainId, 16), {
        staticNetwork: true,
        cacheTimeout: -1, // always read fresh state (see getBrowserProvider)
      })
    )
  }
  return readProviders.get(chainId)
}

/**
 * Requests account access and returns the connected signer + address.
 */
export async function requestAccount() {
  const provider = getBrowserProvider()
  const accounts = await provider.send('eth_requestAccounts', [])
  const signer = await provider.getSigner(accounts[0])
  return { provider, signer, address: accounts[0] }
}

/**
 * Builds a fresh provider + signer for a specific account. Call this when
 * MetaMask reports a different active account or network — an ethers signer
 * stays bound to the account it was created for, so reusing the old one would
 * send transactions "from" the previous account.
 */
export async function buildSigner(address) {
  const provider = getBrowserProvider()
  const signer = await provider.getSigner(address)
  return { provider, signer }
}

/**
 * Reads the currently connected chain ID (hex string, e.g. "0x7a69").
 */
export async function getChainId() {
  if (!hasInjectedWallet()) return null
  return window.ethereum.request({ method: 'eth_chainId' })
}

/**
 * A wallet network is only usable if the contracts are actually deployed on it. Sepolia / Amoy are
 * listed in networks.js for the future, but until something is deployed there a wallet sitting on
 * them must be told to switch to the local chain — not silently used.
 */
export function isChainSupported(chainId) {
  return isDeployedOn(chainId)
}

/**
 * Prompts MetaMask to switch to one of this dApp's supported networks
 * (Hardhat localhost, Sepolia, or Polygon Amoy). Defaults to
 * DEFAULT_CHAIN_ID if no target is given. Falls back to adding the
 * chain if the wallet doesn't already have it configured.
 */
export async function switchToSupportedChain(targetChainId = DEFAULT_CHAIN_ID) {
  if (!hasInjectedWallet()) return
  const network = NETWORKS[targetChainId]
  if (!network) {
    throw new Error(`Unknown target network: ${targetChainId}`)
  }

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetChainId }],
    })
  } catch (switchError) {
    if (switchError?.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: targetChainId,
            chainName: network.name,
            rpcUrls: network.rpcUrl ? [network.rpcUrl] : [],
            blockExplorerUrls: network.blockExplorerUrl ? [network.blockExplorerUrl] : [],
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          },
        ],
      })
    } else {
      throw switchError
    }
  }
}

export function shortenAddress(address, chars = 4) {
  if (!address) return ''
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`
}
