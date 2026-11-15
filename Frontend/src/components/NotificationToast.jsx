import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'

const VARIANTS = {
  success: { icon: CheckCircle2, color: 'text-ledger', border: 'border-ledger/30', bg: 'bg-ledger/5' },
  error: { icon: XCircle, color: 'text-signal-danger', border: 'border-signal-danger/30', bg: 'bg-signal-danger/5' },
  info: { icon: Info, color: 'text-copper', border: 'border-copper/30', bg: 'bg-copper/5' },
  warn: { icon: AlertTriangle, color: 'text-signal-warn', border: 'border-signal-warn/30', bg: 'bg-signal-warn/5' },
}

export function NotificationToast({ type = 'info', title, message, onClose }) {
  const v = VARIANTS[type] || VARIANTS.info
  const Icon = v.icon

  return (
    <div className={`flex items-start gap-3 w-full max-w-sm rounded-xl border ${v.border} ${v.bg} backdrop-blur-xl px-4 py-3 shadow-glass animate-fadeUp`}>
      <Icon size={18} className={`${v.color} mt-0.5 shrink-0`} />
      <div className="flex-1 min-w-0">
        {title && <p className="text-sm font-medium text-parchment">{title}</p>}
        {message && <p className="text-xs text-parchment-muted mt-0.5">{message}</p>}
      </div>
      {onClose && (
        <button onClick={onClose} className="text-parchment-faint hover:text-parchment-muted shrink-0">
          <X size={15} />
        </button>
      )}
    </div>
  )
}

export function ToastStack({ toasts, onDismiss }) {
  if (!toasts?.length) return null
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <NotificationToast key={t.id} {...t} onClose={() => onDismiss(t.id)} />
      ))}
    </div>
  )
}
