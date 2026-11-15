// src/blockchain/contract.js
//
// Single source of truth for contract instantiation. Addresses are no
// longer hardcoded here — they come from networks.js, keyed by the
// wallet's current chainId, so the same code works across Hardhat
// localhost, Sepolia, and Polygon Amoy without edits.

import { Contract } from 'ethers'
import BarterTokenABI from './abi/BarterToken.json'
import EscrowABI from './abi/Escrow.json'
import BarterAgreementABI from './abi/BarterAgreement.json'
import ReputationABI from './abi/Reputation.json'
import { getNetworkConfig, UNDEPLOYED_ADDRESS } from './networks'

export const CONTRACT_ABIS = {
  BarterToken: BarterTokenABI,
  Escrow: EscrowABI,
  BarterAgreement: BarterAgreementABI,
  Reputation: ReputationABI,
}

export class UnsupportedNetworkError extends Error {
  constructor(chainId) {
    super(`No contract addresses configured for chain ${chainId}.`)
    this.name = 'UnsupportedNetworkError'
    this.chainId = chainId
  }
}

/**
 * Builds an ethers Contract instance for one of the four deployed
 * contracts, using the address configured for the given chainId.
 *
 * const agreement = getContract('BarterAgreement', signer, chainId)
 * await agreement.requestTrade(listingId, offeredItem, offeredDescription)
 */
export function getContract(name, signerOrProvider, chainId) {
  const network = getNetworkConfig(chainId)
  if (!network) {
    throw new UnsupportedNetworkError(chainId)
  }

  const address = network.contracts[name]
  const abi = CONTRACT_ABIS[name]
  if (!address || !abi) {
    throw new Error(`Unknown contract: ${name}`)
  }

  // The placeholder address is used until the deploy script has run for
  // this chain — surface that clearly instead of letting calls fail with
  // a cryptic revert.
  if (address === UNDEPLOYED_ADDRESS) {
    throw new Error(
      `${name} is not deployed on ${network.name} yet. ` +
      `Run "npm run dev" in the project folder (it starts the chain and deploys the contracts).`
    )
  }

  return new Contract(address, abi, signerOrProvider)
}
