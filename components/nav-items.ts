import { House, Target, Trophy, VideoCamera } from '@phosphor-icons/react/dist/ssr'

// The four authed destinations, defined once. The header tabs (lg and up) and
// the bottom tab bar (below lg) both read this list, so they cannot drift apart
// the way the five hand-copied headers did.
//
// Four is the ceiling on purpose: a bottom bar stops being scannable past five.

type Glyph = React.ComponentType<{
  size?: number
  weight?: 'regular' | 'fill'
  className?: string
}>

export type NavItem = { href: string; label: string; Glyph: Glyph }

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'LOCKER', Glyph: House },
  { href: '/dashboard/daily', label: 'DAILY', Glyph: Target },
  { href: '/dashboard/live', label: 'LIVE', Glyph: VideoCamera },
  { href: '/dashboard/leaderboard', label: 'BOARD', Glyph: Trophy },
]

// /dashboard has to match exactly. A prefix test would light LOCKER up on every
// screen in the app, since all four live under it.
export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}
