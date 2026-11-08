'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { supabaseBrowser } from '@/lib/supabase'
import { EVENTS, capture } from '@/lib/analytics'
import {
  OUT_OF_TICKETS_EVENT,
  hasSeenPackOffer,
  markPackOfferSeen,
} from '@/lib/pack-offer'
import {
  PACK_FOUNDING_PRICE_LABEL,
  PACK_PRICE_LABEL,
  PACK_SIZE,
  timeUntil,
} from '@/lib/tickets'
import { fetchWallet } from '@/components/ticket-meter'

// Shown ONCE, the first time a user runs out of debates.
//
// This is the only unprompted interruption in the app, so it earns its place by
// being honest about the free path: the headline is what they just hit, and the
// dismiss option states when the next free debate arrives rather than being a
// bare "no thanks". Someone who closes this has still been told the thing they
// most need to know.
//
// Mounted once in app/layout.tsx and inert until the event fires, so it costs
// the landing page a listener and nothing else.
export default function PackOffer() {
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [isFounding, setIsFounding] = useState(false)
  const [nextAt, setNextAt] = useState<Date | null>(null)
  // Guards a second event arriving in the same session before localStorage has
  // been read again (two cap sites can fire on one interaction).
  const firedRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    function onOutOfTickets(e: Event) {
      if (firedRef.current || hasSeenPackOffer()) return
      firedRef.current = true
      markPackOfferSeen()

      const surface = (e as CustomEvent<{ surface?: string }>).detail?.surface
      capture(EVENTS.PACK_OFFER_SHOWN, { surface })
      setOpen(true)

      // Best effort, and the modal renders fine without either: the founding
      // price and the next-ticket time are both nice-to-haves on a surface
      // whose whole job is to be fast.
      void (async () => {
        const wallet = await fetchWallet()
        if (wallet) setNextAt(wallet.nextTicketAt)
        const supabase = supabaseBrowser()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return
        const { data: prof } = await supabase
          .from('profiles')
          .select('is_founding')
          .eq('id', user.id)
          .single()
        setIsFounding(Boolean(prof?.is_founding))
      })()
    }

    window.addEventListener(OUT_OF_TICKETS_EVENT, onOutOfTickets)
    return () => window.removeEventListener(OUT_OF_TICKETS_EVENT, onOutOfTickets)
  }, [])

  // Mount for the fade-in, unmount only once the exit transition has run. Same
  // idempotent shape as the share sheet: React can discard the render pass that
  // queues this, and a `wasOpen` sentinel would then latch the modal shut.
  if (open && !visible) setVisible(true)

  useEffect(() => {
    if (open) return
    const t = setTimeout(() => setVisible(false), 220)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!visible) return
    prevFocusRef.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocusRef.current?.focus()
    }
  }, [visible, close])

  async function buy() {
    setBusy(true)
    setError('')
    capture(EVENTS.CHECKOUT_STARTED, { pack: true, surface: 'pack_offer' })
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.url) {
        setError('Could not open checkout. Try again in a sec.')
        setBusy(false)
        return
      }
      window.location.href = data.url
    } catch {
      setError('Could not reach the server. Try again.')
      setBusy(false)
    }
  }

  if (!visible || typeof document === 'undefined') return null

  const price = isFounding ? PACK_FOUNDING_PRICE_LABEL : PACK_PRICE_LABEL

  return createPortal(
    <div
      role="presentation"
      onClick={close}
      className={`fixed inset-0 z-[100] flex items-end justify-center bg-ink/80 p-4 backdrop-blur-sm transition-opacity duration-200 sm:items-center ${
        open ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pack-offer-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`bezel bezel-primary w-full max-w-md overflow-hidden outline-none transition-all duration-200 ${
          open ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-2.5">
          <span className="font-mono text-[11px] tracking-[0.3em] text-blaze-bright">
            OUT OF TICKETS
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-m-2 inline-flex h-9 w-9 items-center justify-center p-2 text-chalk-3 transition-colors hover:text-chalk"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-4 w-4"
              aria-hidden
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-6">
          <h2
            id="pack-offer-title"
            className="font-athletic text-3xl font-black uppercase leading-[0.95] tracking-tight"
          >
            Not done <span className="text-blaze-bright">arguing?</span>
          </h2>

          <div className="mt-5 flex items-end gap-3">
            <p className="font-athletic text-5xl font-black leading-none tabular-nums text-blaze-bright">
              {price}
            </p>
            <p className="pb-1.5 font-mono text-[11px] tracking-[0.25em] text-chalk-3">
              {PACK_SIZE} TICKETS
            </p>
          </div>

          {isFounding && (
            <p className="mt-2 font-mono text-[10px] font-bold tracking-widest text-blaze-bright">
              FOUNDER 30% OFF APPLIED
            </p>
          )}

          <p className="mt-4 leading-relaxed text-chalk-3">
            One payment, no subscription. They never expire, and Pro is turned on
            for as long as they last.
          </p>

          {/* The only error in the app that carried no role, so a screen
              reader who tapped buy and hit a failure was told nothing. */}
          {error && (
            <p role="alert" className="mt-4 text-sm leading-relaxed text-blaze-bright">
              {error}
            </p>
          )}

          <Button
            size="lg"
            className="mt-6 w-full"
            disabled={busy}
            onClick={buy}
          >
            {busy ? 'OPENING…' : `GET ${PACK_SIZE} TICKETS`}
          </Button>

          {/* The free path, stated plainly. Someone who closes this should
              leave knowing when they can play again, not just that they were
              sold something. */}
          <button
            type="button"
            onClick={close}
            className="mt-3 w-full py-2 font-mono text-[11px] uppercase tracking-widest text-chalk-3 transition-colors hover:text-chalk"
          >
            {nextAt
              ? `No thanks, next one lands ${timeUntil(nextAt)}`
              : 'No thanks'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
