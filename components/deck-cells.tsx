'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { EVENTS, capture } from '@/lib/analytics'
import {
  PACK_FOUNDING_PRICE_LABEL,
  PACK_PRICE_LABEL,
  PACK_SIZE,
  PRO_FOUNDING_PRICE_LABEL,
  PRO_PRICE_LABEL,
  PRO_WEEKLY_FOUNDING_PRICE_LABEL,
  PRO_WEEKLY_PRICE_LABEL,
  WALLET_CHANGED_EVENT,
  refillProgress,
  spendable,
  timeUntil,
  type Wallet,
} from '@/lib/tickets'
import { fetchWallet } from '@/components/ticket-meter'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'

// The Locker room's client islands: the ticket bank, the stake line under the
// Start button, and the Pro card. All three read one wallet.
//
// Since the UX audit (E3, E4, 2026-10-10) they speak in sentences. The old
// cells were spaced mono capitals that wrapped on a phone ("ALL-STAR WIN PAYS
// +300 · 2 STREAK AT RISK"), and the only nudge toward Pro was "PRO BANKS 25",
// which means nothing until you have read the pricing.

// One fetch per page, shared by every cell: they mount together, and three
// RPCs for one number is two too many.
let inflight: Promise<Wallet | null> | null = null

function loadWallet(): Promise<Wallet | null> {
  if (!inflight) {
    inflight = fetchWallet().finally(() => {
      inflight = null
    })
  }
  return inflight
}

type Status = 'loading' | 'ready' | 'failed'

function useWallet(): { wallet: Wallet | null; status: Status } {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  // Re-render every 30s so "lands in 3h 12m" does not go stale on an open tab.
  const [, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const w = await loadWallet()
      if (!alive) return
      setWallet(w)
      setStatus(w ? 'ready' : 'failed')
    }
    void load()
    window.addEventListener('focus', load)
    window.addEventListener(WALLET_CHANGED_EVENT, load)
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => {
      alive = false
      clearInterval(t)
      window.removeEventListener('focus', load)
      window.removeEventListener(WALLET_CHANGED_EVENT, load)
    }
  }, [])

  return { wallet, status }
}

// Pips while the bank is small enough to count at a glance (Free banks 3); a
// bar for Pro's 25, where 25 pips would be noise.
const PIP_LIMIT = 10

// A pack offer in front of a Pro holding 20 tickets is an ad they dismiss on
// every visit. Shown once the balance is genuinely low.
const LOW_BALANCE = 5

/* ── The ticket bank ───────────────────────────────────────────── */

export function DeckWallet({ isFounding = false }: { isFounding?: boolean }) {
  const { wallet, status } = useWallet()

  if (status === 'loading') {
    return (
      <div aria-hidden className="animate-pulse">
        <div className="h-10 w-28 rounded-lg bg-panel-hi" />
        <div className="mt-4 h-7 w-full rounded-md bg-panel-hi" />
        <div className="mt-4 h-3 w-48 rounded-full bg-panel-hi" />
      </div>
    )
  }

  if (status === 'failed' || !wallet) {
    return (
      <p className="text-sm leading-relaxed text-chalk-3">
        Could not load your tickets. Refresh the page and they should come back.
      </p>
    )
  }

  const total = spendable(wallet)
  const empty = total < 1
  const atCap = wallet.tickets >= wallet.bankCap
  const usePips = wallet.bankCap <= PIP_LIMIT
  const progress = refillProgress(wallet)
  const free = wallet.isPro ? '' : 'free '

  return (
    <div>
      <p className="flex items-baseline gap-2.5">
        <span
          className={`font-athletic text-5xl font-black leading-none tabular-nums ${
            empty ? 'text-chalk-3' : total === 1 ? 'text-blaze-bright' : 'text-chalk'
          }`}
        >
          {total}
        </span>
        <span className="text-[15px] font-semibold text-chalk-2">
          {total === 1 ? 'ticket left' : 'tickets'}
        </span>
        <span className="ml-auto shrink-0 self-center rounded-full border border-line-strong px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-chalk-3">
          {wallet.isPro ? 'PRO' : 'FREE'}
        </span>
      </p>

      <div className="mt-4">
        {usePips ? (
          <div
            className="flex gap-1.5"
            role="img"
            aria-label={`${wallet.tickets} of ${wallet.bankCap} tickets banked`}
          >
            {Array.from({ length: wallet.bankCap }).map((_, i) => {
              const filled = i < wallet.tickets
              const isNext = i === wallet.tickets && !atCap
              return (
                <span
                  key={i}
                  className={`relative h-7 flex-1 overflow-hidden rounded-md border ${
                    filled ? 'border-blaze/50 bg-steel' : 'border-line-strong bg-ink/40'
                  }`}
                >
                  {isNext && (
                    <span
                      className="pip-fill absolute inset-y-0 left-0 w-full bg-blaze-bright/25"
                      style={{ transform: `scaleX(${progress})` }}
                    />
                  )}
                </span>
              )
            })}
          </div>
        ) : (
          <div
            className="h-3 w-full overflow-hidden rounded-full bg-ink/50"
            role="img"
            aria-label={`${wallet.tickets} of ${wallet.bankCap} tickets banked`}
          >
            <div
              className="pip-fill h-full w-full origin-left rounded-full bg-steel"
              style={{ transform: `scaleX(${wallet.tickets / wallet.bankCap})` }}
            />
          </div>
        )}
      </div>

      <p className="mt-4 text-sm leading-relaxed text-chalk-3">
        {atCap
          ? `Your bank is full at ${wallet.bankCap}.`
          : wallet.nextTicketAt
            ? `The next ${free}one lands ${timeUntil(wallet.nextTicketAt)}.`
            : 'Another one is on the way.'}{' '}
        {!wallet.isPro && !atCap && `Free banks up to ${wallet.bankCap}.`}
      </p>

      {wallet.isPro && total <= LOW_BALANCE && (
        <Link
          href="/upgrade?view=pack"
          onClick={() => capture(EVENTS.UPGRADE_CLICKED, { surface: 'deck_wallet', intent: 'pack' })}
          className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-blaze-bright hover:text-chalk"
        >
          {PACK_SIZE} more for {isFounding ? PACK_FOUNDING_PRICE_LABEL : PACK_PRICE_LABEL}
          <ArrowRight size={13} weight="bold" aria-hidden />
        </Link>
      )}
    </div>
  )
}

/* ── The stake line ─────────────────────────────────────────────── */

// What the next debate is worth, under the button that starts it. Points and
// streak come from the server; only the out-of-tickets case waits on the
// wallet, and the paragraph's height is reserved by the page so nothing jumps.
export function DeckStakeLine({
  winPoints,
  difficultyName,
  streak,
  isFounding = false,
}: {
  winPoints: number
  /** Sentence case, e.g. "All-Star". */
  difficultyName: string
  streak: number
  isFounding?: boolean
}) {
  const { wallet, status } = useWallet()

  // Out: the bank cell beside this already says when the next one lands, so
  // this line offers the two things that work right now.
  if (status === 'ready' && wallet && spendable(wallet) < 1) {
    return (
      <>
        You&apos;re out of tickets.{' '}
        <Link
          href="/upgrade?view=pack"
          onClick={() => capture(EVENTS.UPGRADE_CLICKED, { surface: 'deck_stake', intent: 'pack' })}
          className="font-semibold text-blaze-bright underline underline-offset-4 hover:text-chalk"
        >
          Get {PACK_SIZE} for {isFounding ? PACK_FOUNDING_PRICE_LABEL : PACK_PRICE_LABEL}
        </Link>
        , or play{' '}
        <Link
          href="/dashboard/daily"
          className="font-semibold text-blaze-bright underline underline-offset-4 hover:text-chalk"
        >
          today&apos;s Daily
        </Link>{' '}
        for free.
      </>
    )
  }

  // A streak of 1 is not something anyone feels they are protecting. From 2 it is.
  const article = /^[AEIOU]/.test(difficultyName) ? 'An' : 'A'
  return (
    <>
      {article} {difficultyName} win pays <span className="font-semibold text-chalk">+{winPoints}</span>.
      {streak > 1 && (
        <>
          {' '}You&apos;re on a <span className="font-semibold text-blaze-bright">{streak}-win streak</span>.
        </>
      )}
    </>
  )
}

/* ── The Pro card ───────────────────────────────────────────────── */

// Names what Pro adds, in plain words, with the price this account would pay.
// Free accounts only: a Pro already has it, and the bank cell shows their count.
// Renders nothing until the wallet answers, so a Pro never sees it flash.
// Taps are counted, like PitchCoach's tip card, to see whether it moves anyone.
export function ProNudge({ isFounding = false }: { isFounding?: boolean }) {
  const { wallet, status } = useWallet()
  if (status !== 'ready' || !wallet || wallet.isPro) return null

  return (
    <div className="rounded-card border border-blaze/35 bg-steel/30 p-5">
      <div className="flex items-center gap-2.5">
        <span className="rounded-full bg-blaze px-2 py-0.5 font-mono text-[9.5px] font-bold tracking-widest text-white">
          PRO
        </span>
        <span className="font-semibold text-chalk">Three debates a day</span>
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-chalk-2">
        Free gets one a week. Pro gets three a day, plus the judge&apos;s Deep Dive on every
        debate, including the ones you lost.
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4">
        <span className="pt-2 text-[13px] text-chalk-3 sm:pt-0">
          {isFounding
            ? `Founders: ${PRO_WEEKLY_FOUNDING_PRICE_LABEL} a week or ${PRO_FOUNDING_PRICE_LABEL} a month`
            : `${PRO_WEEKLY_PRICE_LABEL} a week or ${PRO_PRICE_LABEL} a month`}
        </span>
        <Link
          href="/upgrade"
          onClick={() => capture(EVENTS.UPGRADE_CLICKED, { surface: 'deck_pro_card', intent: 'pro' })}
          className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-blaze-bright hover:text-chalk"
        >
          See Pro
          <ArrowRight size={13} weight="bold" aria-hidden />
        </Link>
      </div>
    </div>
  )
}
