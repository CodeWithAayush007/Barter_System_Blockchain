// src/blockchain/networks.js
//
// One entry per network this dApp can run against. `contract.js` picks
// the right address set based on the wallet's current chainId, so
// switching networks in MetaMask doesn't require a code change.
//
// Addresses are NOT typed in here. `Blockchain/scripts/deploy.js` writes
// them to ./deployed.json (keyed by chain id) every time you deploy, so
// after `npm run dev` (or `npm run deploy:local`) the app already points at the new contracts.

import deployed from './deployed.json'

// Shown for any contract that hasn't been deployed on a given chain yet.
export const UNDEPLOYED_ADDRESS = '0x0000000000000000000000000000000000dEaD'

const CONTRACT_NAMES = ['BarterToken', 'Escrow', 'BarterAgreement', 'Reputation']

function contractsFor(chainId) {
  const fromDeploy = deployed?.[chainId]?.contracts ?? {}
  return Object.fromEntries(
    CONTRACT_NAMES.map((name) => [name, fromDeploy[name] || UNDEPLOYED_ADDRESS])
  )
}

export const NETWORKS = {
  // Hardhat's default local node (started by `npm run dev`). It resets every time
  // it restarts, so the contracts must be deployed again after a restart.
  '0x7a69': {
    // 31337
    name: 'Hardhat Localhost',
    rpcUrl: 'http://127.0.0.1:8545',
    blockExplorerUrl: null,
    contracts: contractsFor('0x7a69'),
  },
  '0xaa36a7': {
    // 11155111 — Sepolia
    name: 'Sepolia Testnet',
    // Set VITE_SEPOLIA_RPC_URL (e.g. your Alchemy/Infura URL) for a faster, more reliable
    // connection; the public node below is the fallback.
    rpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
    blockExplorerUrl: 'https://sepolia.etherscan.io',
    contracts: contractsFor('0xaa36a7'),
  },
  '0x13882': {
    // 80002 — Polygon Amoy
    name: 'Polygon Amoy Testnet',
    rpcUrl: 'https://rpc-amoy.polygon.technology',
    blockExplorerUrl: 'https://amoy.polygonscan.com',
    contracts: contractsFor('0x13882'),
  },
}

// The network the "Connect Wallet" / "Wrong Network" flow nudges users
// toward, and the one read-only data (marketplace before connecting) comes
// from. Local development uses the Hardhat node; the deployed site sets
// VITE_DEFAULT_CHAIN_ID=0xaa36a7 (Sepolia) so every device reads the same chain.
export const DEFAULT_CHAIN_ID = import.meta.env.VITE_DEFAULT_CHAIN_ID || '0x7a69'

export function getNetworkConfig(chainId) {
  return NETWORKS[chainId] || null
}

export function isSupportedChain(chainId) {
  return !!NETWORKS[chainId]
}

/** True once BarterAgreement has a real deployed address on this chain. */
export function isDeployedOn(chainId) {
  const cfg = NETWORKS[chainId]
  return !!cfg && cfg.contracts.BarterAgreement !== UNDEPLOYED_ADDRESS
}

export function listSupportedNetworks() {
  return Object.entries(NETWORKS).map(([chainId, cfg]) => ({ chainId, ...cfg }))
}
