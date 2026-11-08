'use client'

// Depleting ring behind the live H2H clock. CSS-driven (transition on
// stroke-dashoffset, ticked once per second by the parent's clock state) so
// it reads as a continuous countdown rather than a discrete numeral flip.
const RADIUS = 46
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function TurnRing({
  remaining,
  total,
  danger = false,
  className = '',
}: {
  remaining: number
  total: number
  danger?: boolean
  className?: string
}) {
  const pct = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0
  const dash = CIRCUMFERENCE * (1 - pct)

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      className={`absolute h-full w-full -rotate-90 ${className}`}
    >
      <circle
        cx="50"
        cy="50"
        r={RADIUS}
        fill="none"
        stroke="rgba(244, 246, 251, 0.06)"
        strokeWidth="3"
      />
      <circle
        cx="50"
        cy="50"
        r={RADIUS}
        fill="none"
        stroke={danger ? '#f87171' : 'var(--color-blaze-bright)'}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={dash}
        style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease' }}
      />
    </svg>
  )
}
