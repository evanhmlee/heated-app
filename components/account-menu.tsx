'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CreditCard, SignOut } from '@phosphor-icons/react/dist/ssr'
import { supabaseBrowser } from '@/lib/supabase'

// Identity, as a disc rather than a pill.
//
// The header used to carry two visually identical `rounded-full border-line
// bg-panel` pills side by side: one a Link to /upgrade, one an inert div, with
// nothing marking which was tappable. That is the "competing chips" complaint
// stated in CSS, and the fix is deleting one shape, not restyling both. A pill
// and a circle are never confused; two pills always are.
//
// Points move in here and into the deck's box score. They are inert history.
// Tickets are a live spendable resource, so they keep the pill.

export default function AccountMenu({
  username,
  points,
}: {
  username: string
  points: number
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const signOut = async () => {
    await supabaseBrowser().auth.signOut()
    window.location.href = '/'
  }

  const initial = (username.trim()[0] ?? 'B').toUpperCase()

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Account, ${username}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-11 w-11 items-center justify-center rounded-full border border-line-strong bg-panel-hi font-athletic text-sm font-black text-chalk transition-colors hover:border-blaze/60"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="bezel absolute right-0 top-[calc(100%+8px)] w-56 overflow-hidden p-0"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-chalk">{username}</p>
            <p className="mt-0.5 font-mono text-[11px] tracking-widest text-chalk-3">
              <span className="font-bold tabular-nums text-blaze-bright">
                {points.toLocaleString()}
              </span>{' '}
              PTS
            </p>
          </div>

          <Link
            href="/upgrade"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-[44px] items-center gap-2.5 px-4 text-sm text-chalk-2 transition-colors hover:bg-panel-hi hover:text-chalk"
          >
            <CreditCard size={16} aria-hidden />
            Manage plan
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex min-h-[44px] w-full items-center gap-2.5 border-t border-line px-4 text-left text-sm text-chalk-2 transition-colors hover:bg-panel-hi hover:text-chalk"
          >
            <SignOut size={16} aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
