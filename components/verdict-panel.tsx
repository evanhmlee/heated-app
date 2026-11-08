'use client'

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import Link from 'next/link'
import { CaretDown } from '@phosphor-icons/react/dist/ssr'
import { ScoreRing } from '@/components/score-ring'
import ShareVerdictButton from '@/components/share-verdict-button'
import { fetchWallet } from '@/components/ticket-meter'
import { buttonClasses } from '@/components/ui/button'
import {
  ROUND_COPY,
  type DeepDiveEntry,
  type RoundEntry,
  type RubricScores,
} from '@/lib/debate'
import { EVENTS, capture } from '@/lib/analytics'
import {
  PACK_FOUNDING_PRICE_LABEL,
  PACK_PRICE_LABEL,
  PACK_SIZE,
  PRO_FOUNDING_PRICE_LABEL,
  PRO_PRICE_LABEL,
  canDebate,
  spendable,
  timeUntil,
  type Wallet,
} from '@/lib/tickets'

// The verdict, shared by all three arenas (vs the AI, same phone, ranked).
//
// It LEADS. It used to be the last card on a page that opened with six turns of
// transcript, and when a verdict landed live the arena scrolled to the very
// bottom, so on a phone the player saw the Deep Dive lock and the buttons while
// both scores sat about 1,250px above them, counting up for nobody. Now the
// result is the first thing on screen, live or reopened, and the transcript
// folds into "The full debate".
//
// Laptops get two columns: the result on the left, what to do next on the
// right. Phones get one column in the order a player reads it.

export type VerdictOutcome = 'won' | 'lost' | 'draw'

export type VerdictSeat = {
  /** "You", "The AI", or a player's name. */
  name: string
  /** What they argued, when the debate recorded it. */
  side?: string | null
  score: number
  win: boolean
  rubric?: RubricScores | null
}

const RUBRIC: { key: keyof RubricScores; label: string }[] = [
  { key: 'facts', label: 'Facts' },
  { key: 'logic', label: 'Logic' },
  { key: 'delivery', label: 'Delivery' },
]

function possessive(name: string): string {
  return name === 'The AI' ? "the AI's" : `${name}'s`
}

/**
 * The one dimension that explains the result, from the breakdown every verdict
 * has carried since 2026-08-15: the biggest margin in the winner's favour, or on
 * a loss the one that cost the most. Nothing on a draw, and nothing for older
 * verdicts with no breakdown.
 */
function deciderLine(
  left: VerdictSeat,
  right: VerdictSeat,
  outcome: VerdictOutcome | null
): string | null {
  if (!left.rubric || !right.rubric || outcome === 'draw') return null
  const rows = RUBRIC.map(({ key, label }) => ({
    label,
    l: left.rubric![key],
    r: right.rubric![key],
    margin: left.rubric![key] - right.rubric![key],
  }))
  if (outcome === 'won') {
    const best = rows.reduce((a, b) => (b.margin > a.margin ? b : a))
    return best.margin > 0 ? `${best.label} won it: ${best.l} to ${best.r}.` : null
  }
  if (outcome === 'lost') {
    const worst = rows.reduce((a, b) => (b.margin < a.margin ? b : a))
    return worst.margin < 0
      ? `${worst.label} cost you most: ${worst.l} to ${possessive(right.name)} ${worst.r}.`
      : null
  }
  // No single viewer (two people on one phone): say which dimension was widest.
  const widest = rows.reduce((a, b) => (Math.abs(b.margin) > Math.abs(a.margin) ? b : a))
  return widest.margin !== 0 ? `${widest.label} decided it, ${widest.l} to ${widest.r}.` : null
}

// Ring above the words on a phone, beside them from sm. Side by side at 375
// left each label about 60px, so "argued Curry" truncated to "argued ...".
function SeatScore({ seat, delayMs }: { seat: VerdictSeat; delayMs?: number }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:gap-3">
      <ScoreRing score={seat.score} win={seat.win} size="sm" delayMs={delayMs} />
      <div className="flex min-w-0 max-w-full flex-col items-start gap-1">
        {seat.win && (
          <span className="bg-blaze px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-white">
            WINNER
          </span>
        )}
        <span className="max-w-full truncate text-sm font-semibold text-chalk">{seat.name}</span>
        {seat.side && (
          <span className="max-w-full text-[13px] leading-snug text-chalk-3 [overflow-wrap:anywhere]">
            argued {seat.side}
          </span>
        )}
      </div>
    </div>
  )
}

function Breakdown({ left, right }: { left: VerdictSeat; right: VerdictSeat }) {
  if (!left.rubric || !right.rubric) return null
  return (
    <div className="bezel p-5">
      <p className="font-mono text-[10px] font-bold tracking-[0.25em] text-chalk-3">
        HOW THE JUDGE SCORED IT
      </p>
      {/* A key under the title, not beside it: two player names beside it
          wrapped into the title on a phone. */}
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" aria-hidden>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-chalk">
          <span className="h-1.5 w-4 shrink-0 rounded-full bg-blaze-bright" />
          <span className="truncate">{left.name}</span>
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-chalk-3">
          <span className="h-1.5 w-4 shrink-0 rounded-full bg-chalk-3" />
          <span className="truncate">{right.name}</span>
        </span>
      </p>
      <dl className="mt-4 space-y-3.5">
        {RUBRIC.map(({ key, label }) => (
          <div key={key} className="grid grid-cols-[72px_minmax(0,1fr)_28px] items-center gap-x-3">
            <dt className="text-sm font-semibold text-chalk">{label}</dt>
            <dd className="space-y-1.5" aria-hidden>
              <div className="h-1.5 overflow-hidden rounded-full bg-chalk/10">
                <div className="h-full rounded-full bg-blaze-bright" style={{ width: `${left.rubric![key]}%` }} />
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-chalk/10">
                <div className="h-full rounded-full bg-chalk-3" style={{ width: `${right.rubric![key]}%` }} />
              </div>
            </dd>
            <dd className="flex flex-col items-end text-xs tabular-nums leading-tight">
              <span className="font-semibold text-chalk">{left.rubric![key]}</span>
              <span className="text-chalk-3">{right.rubric![key]}</span>
              <span className="sr-only">
                {label}: {left.name} {left.rubric![key]}, {right.name} {right.rubric![key]}.
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// The Deep Dive. Locked, it no longer shows grey bars under "Pro reads the whole
// card": it names the round that decided THIS debate, which the free card has
// always been allowed to show (only the prose is stripped server-side), because
// "you lost it in the rebuttal" is the most specific reason to pay the app has.
function DeepDiveCard({
  entries,
  unlocked,
  outcome,
  isFounding,
  surface,
}: {
  entries: DeepDiveEntry[] | null | undefined
  unlocked: boolean
  outcome: VerdictOutcome | null
  isFounding: boolean
  surface: string
}) {
  // Debates judged before 2026-08-10 have no deep dive, and nothing honest to show.
  if (!entries || entries.length === 0) return null
  const swing = entries.find((e) => e.swing)
  const roundWord = (r: DeepDiveEntry['round']) => (ROUND_COPY[r]?.title ?? r).toLowerCase()

  if (unlocked) {
    return (
      <div className="bezel overflow-hidden">
        <p className="px-5 pb-3 pt-5 font-mono text-[10px] font-bold tracking-[0.25em] text-chalk-3">
          THE JUDGE&apos;S DEEP DIVE
        </p>
        <ul className="divide-y divide-line border-t border-line">
          {entries.map((e) => (
            <li key={e.round} className="px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-chalk-2">
                  {ROUND_COPY[e.round]?.title ?? e.round}
                </span>
                {e.swing && (
                  <span className="bg-blaze px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest text-white">
                    THIS DECIDED IT
                  </span>
                )}
              </div>
              <p className="mt-2 leading-relaxed text-chalk-2">{e.verdict}</p>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const headline = !swing
    ? 'The judge wrote a read of every round.'
    : outcome === 'won'
      ? `You won it in the ${roundWord(swing.round)}.`
      : outcome === 'lost'
        ? `You lost it in the ${roundWord(swing.round)}.`
        : `It turned in the ${roundWord(swing.round)}.`

  return (
    <div className="rounded-card border border-blaze/35 bg-steel/30 p-5">
      <div className="flex items-center gap-2">
        <p className="font-mono text-[10px] font-bold tracking-[0.25em] text-blaze-bright">
          WHERE IT TURNED
        </p>
        <span className="rounded-full bg-blaze px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest text-white">
          PRO
        </span>
      </div>
      <p className="mt-2.5 text-lg font-bold leading-snug text-chalk">{headline}</p>
      <p className="mt-2 text-sm leading-relaxed text-chalk-2">
        {outcome === 'lost'
          ? "Pro opens the judge's read of all three rounds, so you know exactly what to fix next time."
          : "Pro opens the judge's read of all three rounds, on this debate and every one you've played."}
      </p>
      <Link
        href="/upgrade"
        onClick={() => capture(EVENTS.UPGRADE_CLICKED, { surface, intent: 'deep_dive' })}
        className={buttonClasses('secondary', 'lg', 'mt-4 w-full')}
      >
        {outcome === 'lost' ? 'See where you lost it' : 'See the Deep Dive'}
      </Link>
      <p className="mt-2.5 text-center text-[13px] text-chalk-3">
        {isFounding
          ? `Founders pay ${PRO_FOUNDING_PRICE_LABEL} a month`
          : `Pro is ${PRO_PRICE_LABEL} a month`}
      </p>
    </div>
  )
}

function Transcript({
  rounds,
  nameOf,
  isLeft,
}: {
  rounds: RoundEntry[]
  nameOf: (speaker: RoundEntry['speaker']) => string
  isLeft: (speaker: RoundEntry['speaker']) => boolean
}) {
  if (rounds.length === 0) return null
  return (
    <details className="group bezel overflow-hidden">
      <summary className="flex min-h-[60px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-col">
          <span className="font-semibold text-chalk">The full debate</span>
          <span className="text-[13px] text-chalk-3">
            {rounds.length} {rounds.length === 1 ? 'turn' : 'turns'}
          </span>
        </span>
        <CaretDown
          size={18}
          weight="bold"
          aria-hidden
          className="shrink-0 text-chalk-3 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-3 border-t border-line p-4">
        {rounds.map((r, i) => (
          <div
            key={i}
            className={`rounded-card border p-4 ${
              isLeft(r.speaker) ? 'border-blaze/40 bg-steel/20' : 'border-line bg-ink'
            }`}
          >
            <p className="font-mono text-[10px] tracking-[0.25em] text-chalk-3">
              {ROUND_COPY[r.round].title} · {nameOf(r.speaker).toUpperCase()}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-chalk-2">{r.text}</p>
          </div>
        ))}
      </div>
    </details>
  )
}

export default function VerdictPanel({
  eyebrow,
  headline,
  topic,
  summary,
  outcome,
  left,
  right,
  note,
  receipts,
  deepDive,
  deepDiveUnlocked,
  isFounding,
  surface,
  notice,
  points,
  badges,
  actions,
  rounds,
  nameOf,
  isLeft,
  justLanded,
}: {
  /** Short mono label, e.g. "THE VERDICT · ALL-STAR". */
  eyebrow: string
  /** "You won." / "You lost." / "Draw." */
  headline: string
  topic: string
  summary: string
  /** From the viewer's seat. null when two people share one phone. */
  outcome: VerdictOutcome | null
  left: VerdictSeat
  right: VerdictSeat
  note: string
  receipts: string[]
  deepDive: DeepDiveEntry[] | null | undefined
  deepDiveUnlocked: boolean
  isFounding: boolean
  surface: string
  notice?: ReactNode
  points?: ReactNode
  badges?: ReactNode
  actions: ReactNode
  rounds: RoundEntry[]
  nameOf: (speaker: RoundEntry['speaker']) => string
  isLeft: (speaker: RoundEntry['speaker']) => boolean
  /** True when the verdict arrived while the page was open, not on a reload. */
  justLanded: boolean
}) {
  const ref = useRef<HTMLElement>(null)
  const decider = deciderLine(left, right, outcome)

  // Live, the arena was scrolled to the bottom of the transcript when the judge
  // ruled. Bring the top of the result into view instead.
  useEffect(() => {
    if (justLanded) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [justLanded])

  return (
    <section ref={ref} aria-labelledby="verdict-headline" className="pop-in scroll-mt-20">
      {justLanded && (
        <p role="status" className="sr-only">
          {headline} {summary}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-12 lg:items-start lg:gap-8">
        <div className="flex flex-col gap-5 lg:col-span-7">
          <div>
            <p className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-blaze-bright">
              {eyebrow}
            </p>
            <h1
              id="verdict-headline"
              className="mt-2.5 font-athletic text-[2.75rem] font-black uppercase leading-[0.95] tracking-tight [overflow-wrap:anywhere] sm:text-6xl"
            >
              {headline}
            </h1>
            <p className="mt-3 text-[15px] leading-snug text-chalk-2">{topic}</p>
            <p className="mt-2 text-[15px] leading-relaxed text-chalk">
              {summary}
              {decider && <span className="text-chalk-2"> {decider}</span>}
            </p>
          </div>

          {notice}

          <div className="grid grid-cols-2 gap-3 rounded-card border border-blaze/45 bg-panel p-4 sm:p-5">
            <SeatScore seat={left} />
            <SeatScore seat={right} delayMs={150} />
          </div>

          <Breakdown left={left} right={right} />

          <div>
            <p className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-blaze-bright">
              JUDGE&apos;S NOTE
            </p>
            <p className="mt-2.5 leading-relaxed text-chalk">{note}</p>
            {receipts.length > 0 && (
              <ul className="mt-4 space-y-2">
                {receipts.map((r, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm leading-relaxed text-chalk-3">
                    <span aria-hidden className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-blaze-bright" />
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-5">
          {points && <div className="order-1">{points}</div>}
          {badges && <div className="order-1">{badges}</div>}
          {/* Phones: the Pro card, then the buttons. Laptops: the buttons
              first, since the right column is already beside the result. */}
          <div className="order-2 empty:hidden lg:order-3">
            <DeepDiveCard
              entries={deepDive}
              unlocked={deepDiveUnlocked}
              outcome={outcome}
              isFounding={isFounding}
              surface={surface}
            />
          </div>
          <div className="order-3 lg:order-2">{actions}</div>
          <div className="order-4">
            <Transcript rounds={rounds} nameOf={nameOf} isLeft={isLeft} />
          </div>
        </div>
      </div>
    </section>
  )
}

// What to do after a verdict, decided by the wallet. "Run it back" used to send
// a player with no tickets straight into the out-of-tickets card; now that
// player is told when the next free one lands and offered the pack and the
// free Daily instead.
export function VerdictNextStep({
  share,
  rerunHref,
  isFounding,
  surface,
}: {
  share: ComponentProps<typeof ShareVerdictButton>
  rerunHref: string
  isFounding: boolean
  surface: string
}) {
  // undefined = still loading, null = the read failed. Both render the plain
  // buttons rather than a guess about the balance.
  const [wallet, setWallet] = useState<Wallet | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    void fetchWallet().then((w) => {
      if (alive) setWallet(w)
    })
    return () => {
      alive = false
    }
  }, [])

  if (wallet && !canDebate(wallet)) {
    return (
      <div className="bezel flex flex-col gap-3 p-5">
        <p className="font-semibold text-chalk">You&apos;re out of tickets.</p>
        {wallet.nextTicketAt && (
          <p className="text-sm leading-relaxed text-chalk-2">
            Your next {wallet.isPro ? '' : 'free '}ticket lands {timeUntil(wallet.nextTicketAt)}. Or keep
            going now.
          </p>
        )}
        <Link
          href="/upgrade?view=pack"
          onClick={() => capture(EVENTS.UPGRADE_CLICKED, { surface, intent: 'pack' })}
          className={buttonClasses('primary', 'lg', 'w-full')}
        >
          {PACK_SIZE} tickets · {isFounding ? PACK_FOUNDING_PRICE_LABEL : PACK_PRICE_LABEL}
        </Link>
        <Link href="/dashboard/daily" className={buttonClasses('secondary', 'lg', 'w-full')}>
          Play today&apos;s Daily, free
        </Link>
        <ShareVerdictButton {...share} variant="ghost" size="lg" className="w-full" />
      </div>
    )
  }

  const n = wallet ? spendable(wallet) : null
  return (
    <div className="flex flex-col gap-2.5">
      <ShareVerdictButton {...share} size="lg" className="w-full" />
      <Link href={rerunHref} className={buttonClasses('secondary', 'lg', 'w-full')}>
        {n !== null ? 'Run it back · 1 ticket' : 'Run it back'}
      </Link>
      {wallet && n !== null && (
        <p className="text-center text-[13px] text-chalk-3">
          You have {n} {n === 1 ? 'ticket' : 'tickets'}.
          {wallet.nextTicketAt &&
            ` The next ${wallet.isPro ? '' : 'free '}one lands ${timeUntil(wallet.nextTicketAt)}.`}
        </p>
      )}
    </div>
  )
}

// The judge's wait. It was one pulsing line for 10 to 90 seconds, past the
// point where a loop can tell a working system from a hung one. This says what
// the judge actually does and how long it has been. The bar is TIME, not
// progress: the route returns one response, so there is no real step to report
// and inventing one would be a lie a screenshot can catch.
export function JudgingCard({ elapsed, opponent }: { elapsed: number; opponent: string }) {
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const slow = elapsed >= 60
  return (
    <div role="status" className="rounded-card border border-blaze/45 bg-panel p-5 sm:p-6">
      <p className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-blaze-bright">
        THE JUDGE IS RULING
      </p>
      <p className="mt-2 font-athletic text-2xl font-black uppercase tracking-tight">
        All six turns are in.
      </p>
      <ul className="mt-4 space-y-2.5 text-[15px] leading-snug text-chalk-2">
        <li className="flex gap-3">
          <span aria-hidden className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-blaze-bright" />
          Reads your case and {possessive(opponent)}, round by round
        </li>
        <li className="flex gap-3">
          <span aria-hidden className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-blaze-bright" />
          Checks the player stats you cited against real career numbers
        </li>
        <li className="flex gap-3">
          <span aria-hidden className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-blaze-bright" />
          Scores facts, logic and delivery for both of you
        </li>
      </ul>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-chalk/10" aria-hidden>
        <div
          className="h-full rounded-full bg-blaze-bright transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.min(100, (elapsed / 60) * 100)}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[13px] text-chalk-3">
        <span className="tabular-nums">{clock}</span>
        <span>{slow ? 'Taking longer than usual. Still working.' : 'Usually under a minute'}</span>
      </div>
    </div>
  )
}
