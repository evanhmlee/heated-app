'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const RADIUS = 52
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// useLayoutEffect warns when React renders on the server, and useEffect is the
// correct no-op there. The ring needs the layout variant on the client so the
// wind-back to zero lands BEFORE the first paint: with a plain useEffect the
// browser paints the real score, then jumps to 0, then counts back up to it.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

// Heavy, physical deceleration — matches --ease-premium's feel without
// needing to sample a cubic-bezier in JS.
function easeOutExpo(t: number) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

// Cinematic score reveal: the ring sweeps in and the numeral counts up
// together, eased to a dead stop. One winner-only glow keeps the accent
// scarce (tonal-blue rule) instead of lighting up every ring on screen.
export function ScoreRing({
  score,
  win = false,
  delayMs = 0,
  size = 'md',
  className = '',
}: {
  score: number
  win?: boolean
  delayMs?: number
  /** sm fits two rings side by side on a 375px phone. */
  size?: 'md' | 'sm'
  className?: string
}) {
  const [reducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  // Both start at the FINAL value, and the animation winds back to zero on
  // mount rather than counting up from a zero that was rendered server-side.
  //
  // The old initialisers keyed off `reducedMotion`, which is always false on
  // the server, so every ring shipped `0` in its HTML. On /v/[id], the public
  // permalink a stranger opens from a group chat in a slow in-app browser, the
  // score IS the page: the markup said 0 to 0 until hydration plus 1.3s of
  // count-up. It also hydration-mismatched for reduced-motion visitors, who
  // computed `score` on the client against the server's 0.
  const finalDash = CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, score / 100)))
  const [display, setDisplay] = useState(score)
  const [dash, setDash] = useState(finalDash)
  const rafRef = useRef<number | null>(null)

  useIsomorphicLayoutEffect(() => {
    if (reducedMotion) return

    // Wind back to zero, then animate. Runs only on the client and before
    // paint, so the served HTML keeps the real number and the viewer still
    // sees the count-up from zero.
    setDisplay(0)
    setDash(CIRCUMFERENCE)

    const duration = 1300
    const pct = Math.min(1, Math.max(0, score / 100))
    let start: number | null = null

    function tick(now: number) {
      if (start === null) start = now
      const t = Math.min(1, (now - start) / duration)
      const eased = easeOutExpo(t)
      setDisplay(Math.round(eased * score))
      setDash(CIRCUMFERENCE * (1 - eased * pct))
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }

    const timeout = setTimeout(() => {
      rafRef.current = requestAnimationFrame(tick)
    }, delayMs)

    return () => {
      clearTimeout(timeout)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [score, delayMs, reducedMotion])

  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center ${
        size === 'sm' ? 'h-[72px] w-[72px] sm:h-24 sm:w-24' : 'h-28 w-28 sm:h-32 sm:w-32'
      } ${className}`}
    >
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          stroke="rgba(244, 246, 251, 0.07)"
          strokeWidth="7"
        />
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          stroke={win ? 'var(--color-blaze-bright)' : 'rgba(244, 246, 251, 0.3)'}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dash}
          style={
            win
              ? // Ember, matching --color-blaze-bright. This was still the old
                // pre-rebrand blue, so a winning ring glowed blue on a red brand.
                { filter: 'drop-shadow(0 0 4px rgba(240, 74, 56, 0.4))' }
              : undefined
          }
        />
      </svg>
      <span
        className={`absolute font-athletic font-black leading-none tabular-nums ${
          size === 'sm' ? 'text-2xl sm:text-3xl' : 'text-4xl sm:text-5xl'
        } ${
          win ? 'text-blaze-bright' : 'text-chalk-3'
        }`}
      >
        {display}
      </span>
    </div>
  )
}
