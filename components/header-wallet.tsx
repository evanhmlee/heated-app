'use client'

import { usePathname } from 'next/navigation'
import TicketMeter from '@/components/ticket-meter'

// The rule this enforces: the wallet appears exactly ONCE per screen, at the
// largest size that screen affords.
//
// On /dashboard the deck has a whole bank cell for it, so the header chip would
// be a second, smaller, worse copy of a number already on screen. Everywhere
// else in the hub there is no bank cell, so the compact chip is the only place
// the balance appears.
//
// Pathname is a client concern, which is the only reason this wrapper exists;
// AppHeader itself stays a server component.

export default function HeaderWallet() {
  const pathname = usePathname()
  if (pathname === '/dashboard') return null
  return <TicketMeter compact />
}
