// src/hooks/useWallet.jsx
//
// App-wide wallet state. Wrap the app once in <WalletProvider>, then
// call useWallet() from any component to read the connected address,
// chain, and connection status, or to trigger connect/disconnect.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  hasInjectedWallet,
  requestAccount,
  buildSigner,
  getChainId,
  switchToSupportedChain,
  isChainSupported,
} from '../blockchain/provider'
import { getNetworkConfig, DEFAULT_CHAIN_ID } from '../blockchain/networks'
import { parseError } from '../utils/errors'

const WalletContext = createContext(null)

export function WalletProvider({ children }) {
  const [address, setAddress] = useState(null)
  const [signer, setSigner] = useState(null)
  const [provider, setProvider] = useState(null)
  const [chainId, setChainId] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [switchingNetwork, setSwitchingNetwork] = useState(false)
  const [error, setError] = useState(null)

  // The event listeners below are registered once, so they read the current
  // address through a ref instead of a stale closure.
  const addressRef = useRef(null)
  useEffect(() => {
    addressRef.current = address
  }, [address])

  const isWrongNetwork = chainId !== null && !isChainSupported(chainId)
  const network = chainId ? getNetworkConfig(chainId) : null

  const connect = useCallback(async () => {
    setError(null)
    if (!hasInjectedWallet()) {
      setError('No wallet detected. Install MetaMask to connect.')
      return
    }
    setConnecting(true)
    try {
      const { provider: p, signer: s, address: a } = await requestAccount()
      setProvider(p)
      setSigner(s)
      setAddress(a)
      const cid = await getChainId()
      setChainId(cid)
    } catch (err) {
      setError(parseError(err))
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setAddress(null)
    setSigner(null)
    setProvider(null)
    setChainId(null)
    setError(null)
  }, [])

  const switchNetwork = useCallback(async (targetChainId = DEFAULT_CHAIN_ID) => {
    setSwitchingNetwork(true)
    setError(null)
    try {
      await switchToSupportedChain(targetChainId)
      const cid = await getChainId()
      setChainId(cid)
    } catch (err) {
      setError(parseError(err))
    } finally {
      setSwitchingNetwork(false)
    }
  }, [])

  // Keep state in sync with MetaMask account/network changes.
  //
  // An ethers signer is bound to the account (and network) it was created for.
  // If we only updated the displayed address, transactions would still be sent
  // "from" the previous account — so rebuild the provider + signer every time.
  useEffect(() => {
    if (!hasInjectedWallet()) return

    const rebuild = async (nextAddress) => {
      const { provider: p, signer: s } = await buildSigner(nextAddress)
      setProvider(p)
      setSigner(s)
    }

    const handleAccountsChanged = async (accounts) => {
      if (!accounts || accounts.length === 0) {
        disconnect()
        return
      }
      try {
        await rebuild(accounts[0])
        setAddress(accounts[0])
      } catch (err) {
        setError(parseError(err))
      }
    }

    const handleChainChanged = async (cid) => {
      setChainId(cid)
      if (addressRef.current) {
        try {
          await rebuild(addressRef.current)
        } catch (err) {
          setError(parseError(err))
        }
      }
    }

    window.ethereum.on?.('accountsChanged', handleAccountsChanged)
    window.ethereum.on?.('chainChanged', handleChainChanged)
    return () => {
      window.ethereum.removeListener?.('accountsChanged', handleAccountsChanged)
      window.ethereum.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [disconnect])

  const value = {
    address,
    signer,
    provider,
    chainId,
    network,
    connecting,
    switchingNetwork,
    error,
    clearError: () => setError(null),
    isConnected: !!address,
    isWrongNetwork,
    connect,
    disconnect,
    switchNetwork,
  }

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider')
  return ctx
}
