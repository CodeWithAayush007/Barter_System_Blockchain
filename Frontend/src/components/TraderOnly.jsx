import { Link } from 'react-router-dom'
import { Gavel } from 'lucide-react'
import { useAdmin } from '../hooks/useAdmin'

/**
 * Wraps the pages that only make sense for a trader (creating listings, trades,
 * reputation, tokens). The platform admin is a referee, not a trader: the contract refuses
 * its listings and requests and it has no reputation, so the app does not offer them.
 */
export default function TraderOnly({ children }) {
  const { isAdmin } = useAdmin()
  if (!isAdmin) return children
  return (
    <div className="max-w-lg mx-auto py-24 px-5 text-center" data-testid="admin-no-trading">
      <span className="grid place-items-center h-14 w-14 rounded-2xl bg-copper/10 border border-copper/25 mx-auto mb-5">
        <Gavel size={24} className="text-copper" />
      </span>
      <h1 className="font-display font-semibold text-2xl text-parchment mb-2">The admin does not trade</h1>
      <p className="text-parchment-muted text-sm mb-6">
        This wallet is the platform admin: it rules on disputes and keeps the history of past ones. It cannot list items, request trades
        or hold a reputation. To trade, use a different wallet.
      </p>
      <Link to="/admin" className="btn-primary mx-auto">Go to the Admin page</Link>
    </div>
  )
}
