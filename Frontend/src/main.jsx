import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { WalletProvider } from './hooks/useWallet.jsx'
import { AuthProvider } from './hooks/useAuth.jsx'
import { BarterProvider } from './hooks/useBarter.jsx'
import { ToastProvider } from './hooks/useToasts.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <WalletProvider>
        <AuthProvider>
          <BarterProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </BarterProvider>
        </AuthProvider>
      </WalletProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
