import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Menu, X, ArrowLeftRight } from 'lucide-react'
import WalletButton from './WalletButton'
import { useAdmin } from '../hooks/useAdmin'

const LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/marketplace', label: 'Marketplace' },
  { to: '/create', label: 'Create Listing' },
  { to: '/trades', label: 'Trades' },
  { to: '/reputation', label: 'Reputation' },
  { to: '/tokens', label: 'Tokens' },
  { to: '/rules', label: 'Rules' },
]

// The admin is a referee, not a trader: no listing, trades, reputation or tokens — just the Admin page.
const ADMIN_LINKS = [
  { to: '/admin', label: 'Admin' },
  { to: '/marketplace', label: 'Marketplace' },
  { to: '/rules', label: 'Rules' },
]

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { isAdmin } = useAdmin()
  const links = isAdmin ? ADMIN_LINKS : LINKS

  return (
    <header className="sticky top-0 z-40 border-b border-ink-border bg-ink/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <NavLink to="/" className="flex items-center gap-2 shrink-0">
          <span className="grid place-items-center h-8 w-8 rounded-lg bg-copper/15 border border-copper/30">
            <ArrowLeftRight size={16} className="text-copper" />
          </span>
          <span className="font-display font-semibold text-lg tracking-tight">Trove</span>
        </NavLink>

        <nav className="hidden lg:flex items-center gap-1">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `px-2.5 xl:px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'text-parchment bg-white/[0.06]' : 'text-parchment-muted hover:text-parchment hover:bg-white/[0.03]'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden lg:block">
          <WalletButton />
        </div>

        <button
          className="lg:hidden p-2 text-parchment-muted hover:text-parchment"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle navigation menu"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t border-ink-border px-5 py-4 space-y-1 animate-fadeUp">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `block px-3.5 py-2.5 rounded-lg text-sm font-medium ${
                  isActive ? 'text-parchment bg-white/[0.06]' : 'text-parchment-muted'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
          <div className="pt-2">
            <WalletButton />
          </div>
        </div>
      )}
    </header>
  )
}
