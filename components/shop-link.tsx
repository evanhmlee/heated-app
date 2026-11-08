'use client'

import Link from 'next/link'
import { Storefront } from '@phosphor-icons/react/dist/ssr'
import { EVENTS, capture } from '@/lib/analytics'

// The store, reachable from every authed screen.
//
// Until now the only way in was the ticket meter, which is a number you have to
// know is tappable, and which HeaderWallet deliberately hides on /dashboard.
// That left the locker room, the screen people open most, with no entry to the
// place that sells anything.
//
// Deliberately NOT a third disc. The right cluster already carries a numeric
// pill (the meter) and a filled circle (the account initial); a third filled
// shape is the "competing chips" problem that AccountMenu was rebuilt to fix.
// A bare glyph on a transparent hit area reads as a tool, not as a peer of the
// two things beside it, while still hitting 44px.
//
// It sits to the LEFT of the meter so the reading order is store, then balance,
// then you: the two money things stay adjacent instead of being split by an
// avatar.
//
// 36 x 44 below sm, 44 square from sm. Full height is kept everywhere; only the
// hit area narrows, and only on the one width where the header is actually
// tight. Three 44px items plus their gaps do not fit beside the lockup at
// 375px, and a header that wraps is worse than an 8px-narrower target.

export default function ShopLink() {
  return (
    <Link
      href="/upgrade"
      aria-label="Store"
      title="Store"
      onClick={() => capture(EVENTS.UPGRADE_CLICKED, { surface: 'header_shop' })}
      className="flex h-11 w-9 shrink-0 sm:w-11 items-center justify-center rounded-full text-chalk-3 transition-colors hover:bg-panel-hi hover:text-chalk focus-visible:bg-panel-hi focus-visible:text-chalk"
    >
      <Storefront size={22} aria-hidden />
    </Link>
  )
}
