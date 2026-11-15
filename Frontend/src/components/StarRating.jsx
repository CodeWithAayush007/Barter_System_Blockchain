import { useState } from 'react'
import { Star } from 'lucide-react'

/**
 * Five stars. Read-only by default; pass `onChange` to make it a picker
 * (hover previews the selection, keyboard-accessible via the radio group).
 */
export default function StarRating({ value = 0, onChange, size = 16, label = 'Rating' }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  const interactive = typeof onChange === 'function'

  return (
    <div
      className="inline-flex items-center gap-0.5"
      role={interactive ? 'radiogroup' : 'img'}
      aria-label={interactive ? label : `${value} out of 5 stars`}
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= shown
        const star = <Star size={size} className={filled ? 'fill-copper text-copper' : 'text-ink-border'} />
        if (!interactive) return <span key={n}>{star}</span>
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            className="p-0.5 rounded transition-transform hover:scale-110"
          >
            {star}
          </button>
        )
      })}
    </div>
  )
}
