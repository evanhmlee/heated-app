'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, isNavActive } from '@/components/nav-items'

// The mobile half of the wayfinding. Sits at z-50, above the fixed .grain
// overlay at z-40, so the glyphs are not filtered through noise. Any future
// modal has to clear z-50.
//
// pb-[env(safe-area-inset-bottom)] keeps the labels off the iOS home indicator.
// The hub layout reserves matching bottom padding so the last card on a page is
// never trapped underneath this bar.

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
    >
      <ul className="mx-auto flex max-w-[1400px]">
        {NAV_ITEMS.map(({ href, label, Glyph }) => {
          const active = isNavActive(pathname, href)
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-[56px] flex-col items-center justify-center gap-1 transition-colors ${
                  active ? 'text-blaze-bright' : 'text-chalk-3'
                }`}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-4 top-0 h-0.5 bg-blaze"
                  />
                )}
                <Glyph size={20} weight={active ? 'fill' : 'regular'} aria-hidden />
                <span className="font-mono text-[10px] tracking-[0.2em]">{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
