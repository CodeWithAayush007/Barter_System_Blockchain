// src/hooks/useAuth.jsx
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useWallet } from './useWallet.jsx'
import { apiFetch, getToken, setToken, clearToken } from '../utils/api'
import { parseError } from '../utils/errors'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const { address, signer } = useWallet()
  const [user, setUser] = useState(null)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState(null)

  // If the wallet disconnects or switches to a different address than
  // the one the stored token was issued for, drop the session — a
  // stale token for a different address should never be sent.
  useEffect(() => {
    if (!address) {
      clearToken()
      setUser(null)
      return
    }
    if (user && user.address?.toLowerCase() !== address.toLowerCase()) {
      clearToken()
      setUser(null)
    }
  }, [address, user])

  const signIn = useCallback(async () => {
    if (!address || !signer) {
      setError('Connect your wallet first.')
      return { ok: false }
    }
    setSigningIn(true)
    setError(null)
    try {
      const { message } = await apiFetch(`/auth/nonce/${address}`, { auth: false })
      const signature = await signer.signMessage(message)
      const { token, user: apiUser } = await apiFetch('/auth/verify', {
        method: 'POST',
        body: { address, signature },
        auth: false,
      })
      setToken(token)
      setUser(apiUser)
      return { ok: true }
    } catch (err) {
      const message = parseError(err)
      setError(message)
      return { ok: false, error: message }
    } finally {
      setSigningIn(false)
    }
  }, [address, signer])

  const signOut = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const value = {
    user,
    isAuthenticated: !!user && !!getToken(),
    signingIn,
    error,
    signIn,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
