// src/hooks/useToasts.jsx
import { createContext, useCallback, useContext, useState } from 'react'
import { ToastStack } from '../components/NotificationToast'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const push = useCallback((toast) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString()
    setToasts((t) => [...t, { id, ...toast }])
    const duration = toast.duration ?? 5000
    if (duration > 0) {
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), duration)
    }
    return id
  }, [])

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToasts() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToasts must be used within a ToastProvider')
  return ctx
}
