import { Loader2 } from 'lucide-react'

export default function LoadingSpinner({ size = 18, label, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 text-parchment-muted ${className}`}>
      <Loader2 size={size} className="animate-spin text-ledger" />
      {label && <span className="text-sm font-mono">{label}</span>}
    </span>
  )
}
