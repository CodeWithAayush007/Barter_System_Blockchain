import { NavLink } from 'react-router-dom'
import { LayoutGrid, Store, PlusCircle, ArrowLeftRight, ShieldCheck, Coins, BookOpenText, Gavel } from 'lucide-react'
import { useAdmin } from '../hooks/useAdmin'

const ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { to: '/marketplace', label: 'Marketplace', icon: Store },
  { to: '/create', label: 'Create Listing', icon: PlusCircle },
  { to: '/trades', label: 'Trades', icon: ArrowLeftRight },
  { to: '/reputation', label: 'Reputation', icon: ShieldCheck },
  { to: '/tokens', label: 'Tokens', icon: Coins },
  { to: '/rules', label: 'Barter Rules', icon: BookOpenText },
]

export default function Sidebar() {
  // The admin is a referee, not a trader: it gets the Admin page (with a badge for cases that need it),
  // the marketplace to browse and the rules — and none of the trading pages.
  const { isAdmin, pendingCount } = useAdmin({ withDisputes: true })
  const items = isAdmin
    ? [
        { to: '/admin', label: 'Admin', icon: Gavel, badge: pendingCount },
        ITEMS.find((i) => i.to === '/marketplace'),
        ITEMS.find((i) => i.to === '/rules'),
      ]
    : ITEMS

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-ink-border min-h-[calc(100vh-4rem)] py-6 px-3 gap-1">
      {items.map(({ to, label, icon: Icon, badge }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-copper/10 text-copper border border-copper/20'
                : 'text-parchment-muted hover:text-parchment hover:bg-white/[0.03] border border-transparent'
            }`
          }
        >
          <Icon size={17} />
          {label}
          {badge > 0 && (
            <span className="ml-auto text-[11px] font-mono rounded-full bg-signal-danger/15 text-signal-danger px-2 py-0.5">
              {badge}
            </span>
          )}
        </NavLink>
      ))}
    </aside>
  )
}
