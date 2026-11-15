import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, title, children, footer }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fadeUp"
        onClick={onClose}
        aria-hidden="true"
      />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative w-full max-w-md card p-6 shadow-glass animate-fadeUp">
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-display font-semibold text-lg text-parchment">{title}</h3>
          <button onClick={onClose} className="text-parchment-faint hover:text-parchment-muted" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="text-sm text-parchment-muted">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 mt-6">{footer}</div>}
      </div>
    </div>
  )
}
