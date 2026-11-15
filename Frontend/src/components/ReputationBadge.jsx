import { formatRating } from '../utils/format'

// Renders reputation as a small progress ring filled to the average rating
// (out of 5 stars) — no bronze/silver/gold tier labels. A wallet with no
// ratings yet just reads "New".
export default function ReputationBadge({ averageRating = 0, ratingCount = 0, size = 36, showLabel = true }) {
  const ratingOutOf5 = averageRating / 100 // contract returns rating x 100
  const radius = (size - 4) / 2
  const circumference = 2 * Math.PI * radius
  const fillFraction = ratingCount > 0 ? ratingOutOf5 / 5 : 0
  const offset = circumference - fillFraction * circumference

  const ringColor =
    ratingCount === 0 ? '#5B6478' : ratingOutOf5 >= 4 ? '#3FC1B0' : ratingOutOf5 >= 2.5 ? '#D98F4E' : '#E0575A'

  const label = ratingCount > 0 ? `${formatRating(averageRating)} ★` : 'New'

  return (
    <div className="inline-flex items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(232,234,240,0.08)"
            strokeWidth="3"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center font-mono text-[9px] font-semibold text-parchment">
          {ratingCount > 0 ? ratingOutOf5.toFixed(1) : '–'}
        </span>
      </div>
      {showLabel && (
        <span className="text-xs font-medium text-parchment-muted">{label}</span>
      )}
    </div>
  )
}
