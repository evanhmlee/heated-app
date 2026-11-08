'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { PACK_SIZE, announceWalletChanged, type Wallet } from '@/lib/tickets'
import { fetchWallet } from '@/components/ticket-meter'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'

// What someone sees when Stripe sends them back after paying.
//
// The awkward part is that fulfilment is ASYNCHRONOUS. Stripe redirects the
// browser the instant the payment clears, but the tickets are granted by the
// webhook, which arrives on its own schedule. So the naive version ("10 debates
// added!") is a lie a meaningful fraction of the time, and the equally naive
// fix (say nothing until the webhook lands) leaves someone who just paid
// staring at an unchanged page.
//
// So: acknowledge the PAYMENT immediately, because Stripe redirecting here is
// proof of that, and separately report the GRANT once it actually shows up in
// the wallet. Three states, and the third one is the honest failure:
//
//   pending   payment confirmed, tickets not visible yet
//   granted   the wallet moved, say what they got
//   slow      POLL_WINDOW elapsed with no change; say so plainly and point at
//             support rather than claiming a success we cannot see
//
// A stuck webhook is exactly when a user most needs to be told the truth, and
// "it worked!" over a balance that did not move is how a $1.99 charge turns
// into a chargeback.

const POLL_MS = 2000
const POLL_WINDOW_MS = 24000

type Kind = 'pack' | 'pro'
type State = 'pending' | 'granted' | 'slow'

export default function PurchaseConfirmation() {
  const params = useSearchParams()
  const router = useRouter()

  // Read ONCE, on the first render, via a lazy initializer. It cannot be
  // derived from params on every render: the effect below strips the query
  // string, which would immediately unmount the banner it just showed.
  const [kind] = useState<Kind | null>(() =>
    params.get('pack') === 'success'
      ? 'pack'
      : params.get('upgraded') === 'true'
        ? 'pro'
        : null
  )
  const [state, setState] = useState<State>('pending')
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!kind || startedRef.current) return
    const detected = kind
    startedRef.current = true

    // Drop the query string straight away so a refresh (or a back button) does
    // not replay a confirmation for a purchase that already settled.
    router.replace('/dashboard', { scroll: false })

    let cancelled = false
    const deadline = Date.now() + POLL_WINDOW_MS
    let baseline: Wallet | null = null
    let isFirstRead = true

    async function poll() {
      const w = await fetchWallet()
      if (cancelled) return
      if (w) setWallet(w)

      let landed = false
      if (w) {
        if (isFirstRead) {
          // The webhook often beats this page. On the FIRST read there is no
          // "before" to compare against, so fall back to asking whether the
          // promise is already satisfied: Pro is on, or the purchased pool
          // already holds at least a full pack. (A repeat buyer who happened to
          // be sitting on 10+ tickets gets told "added" a second or two early.
          // That is the right way to be wrong here.)
          landed = detected === 'pro' ? w.isPro : w.purchased >= PACK_SIZE
          baseline = w
          isFirstRead = false
        } else if (baseline) {
          // Afterwards, the honest signal is movement.
          landed = detected === 'pro' ? w.isPro : w.purchased > baseline.purchased
        }
      }

      if (landed) {
        setState('granted')
        announceWalletChanged()
        return
      }

      if (Date.now() >= deadline) {
        setState('slow')
        return
      }
      setTimeout(() => void poll(), POLL_MS)
    }

    void poll()
    return () => {
      cancelled = true
    }
  }, [kind, router])

  if (!kind) return null

  const copy = {
    pack: {
      pending: {
        title: 'Payment received.',
        body: `Adding your ${PACK_SIZE} tickets. This usually takes a couple of seconds.`,
      },
      granted: {
        title: `${PACK_SIZE} tickets added.`,
        body: wallet
          ? `You have ${wallet.tickets + wallet.purchased} ready to go, and Pro is on while they last.`
          : 'Pro is on while they last.',
      },
      slow: {
        title: 'Payment received, tickets still landing.',
        body: 'Your tickets are not showing yet. Give it a minute and refresh. If they still are not here, the receipt in your email has everything support needs.',
      },
    },
    pro: {
      pending: {
        title: 'Payment received.',
        body: 'Switching your account to Pro.',
      },
      granted: {
        title: 'Pro is on.',
        body: 'Three debates a day, custom topics, and the judge full reasoning on every verdict.',
      },
      slow: {
        title: 'Payment received, Pro still switching on.',
        body: 'Your account has not flipped over yet. Give it a minute and refresh. If it still has not, the receipt in your email has everything support needs.',
      },
    },
  }[kind][state]

  const isSlow = state === 'slow'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`bezel mb-8 flex flex-wrap items-center justify-between gap-4 px-5 py-4 ${
        isSlow ? 'border-blaze/40' : ''
      }`}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2.5 font-athletic text-xl font-black uppercase tracking-tight">
          {state === 'pending' ? (
            <span
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-blaze/30 border-t-blaze-bright"
            />
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 shrink-0 ${isSlow ? 'text-chalk-3' : 'text-blaze-bright'}`}
              aria-hidden
            >
              {isSlow ? <path d="M12 8v5M12 17h.01" /> : <path d="M20 6 9 17l-5-5" />}
            </svg>
          )}
          {copy.title}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-chalk-3">{copy.body}</p>
      </div>

      {state === 'granted' && kind === 'pack' && (
        <Link
          href="/dashboard/debate/new"
          className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-widest text-blaze-bright hover:text-chalk"
        >
          Start a debate
          <ArrowRight size={12} weight="bold" aria-hidden className="ml-1 inline align-[-1px]" />
        </Link>
      )}
    </div>
  )
}
