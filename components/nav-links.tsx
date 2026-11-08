'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, isNavActive } from '@/components/nav-items'

// Header tabs, lg and up. Below lg the same four items render as the bottom tab
// bar, so nothing is ever `hidden sm:inline` again. That pattern is what made
// the leaderboard unreachable from the dashboard on a phone, in a product whose
// whole retention loop is climbing a board.

export default function NavLinks() {
  const pathname = usePathname()

  return (
    <nav aria-label="Sections" className="hidden lg:block">
      <ul className="flex items-center">
        {NAV_ITEMS.map(({ href, label }) => {
          const active = isNavActive(pathname, href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`relative inline-flex min-h-[44px] items-center px-3 font-mono text-[11px] font-bold tracking-[0.2em] transition-colors ${
                  active ? 'text-chalk' : 'text-chalk-3 hover:text-chalk'
                }`}
              >
                {label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 bottom-0 h-0.5 bg-blaze"
                  />
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
