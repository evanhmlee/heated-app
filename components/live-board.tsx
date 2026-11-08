'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { CaretRight } from '@phosphor-icons/react/dist/ssr'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, buttonClasses } from '@/components/ui/button'
import { DIFFICULTY_NAME, LOBBY_TTL_MINUTES, type Difficulty } from '@/lib/debate'
import { EVENTS, capture } from '@/lib/analytics'
import { announceOutOfTickets } from '@/lib/pack-offer'

export type BoardLobby = {
  id: string
  hostId: string
  topicSource: 'random' | 'custom'
  topicText: string | null
  hostSide: string | null
  guestSide: string | null
  difficulty: string
  turnSeconds: number
  createdAt: string
  host: { username: string; points: number; wins: number; losses: number }
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// Pinned locale. This component is 'use client' but still server-renders, and
// toLocaleString() resolves against the runtime's locale: Node formats 1234 as
// "1,234" and a browser in a de-DE locale formats it "1.234". That is a real
// hydration mismatch, not a hypothetical one.
const NUM = new Intl.NumberFormat('en-US')

// Minutes left on a lobby, given a clock supplied by the caller. Takes `now`
// rather than reading Date.now() so it stays pure: the old timeAgo() read the
// clock during render, which server-rendered one value and hydrated another.
function minsLeft(iso: string, now: number): number {
  const elapsed = Math.floor((now - new Date(iso).getTime()) / 60000)
  return Math.max(0, LOBBY_TTL_MINUTES - elapsed)
}

// The clock, as an external store rather than a mounted flag in state. This is
// the SSR-safe shape: getServerSnapshot returns null so the server renders no
// time at all, and the client snapshot is bucketed to the tick interval so it
// is stable between ticks (an unbucketed Date.now() would return a new value on
// every call and React would flag an uncached snapshot).
const CLOCK_MS = 30_000
const subscribeClock = (cb: () => void) => {
  const t = setInterval(cb, CLOCK_MS)
  return () => clearInterval(t)
}
const clientClock = () => Math.floor(Date.now() / CLOCK_MS) * CLOCK_MS
const serverClock = (): number | null => null

// The client half of the live board: join buttons, the code form, and a
// gentle auto-refresh so open lobbies appear without a manual reload.
export default function LiveBoard({
  lobbies,
  myUserId,
  myOpenLobbyId,
  myPendingLobbyIds,
}: {
  lobbies: BoardLobby[]
  myUserId: string
  myOpenLobbyId: string | null
  myPendingLobbyIds: string[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [code, setCode] = useState(searchParams.get('code')?.toUpperCase() ?? '')
  const [joining, setJoining] = useState<string | null>(null) // lobby id or 'code'
  const [error, setError] = useState('')

  // Null on the server and on first paint, so nothing clock-dependent can
  // differ between the two renders.
  const now = useSyncExternalStore(subscribeClock, clientClock, serverClock)

  // Refresh the board every 15s (server component re-renders with fresh rows).
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15000)
    return () => clearInterval(t)
  }, [router])

  async function join(body: { lobbyId?: string; code?: string }, key: string) {
    setJoining(key)
    setError('')
    try {
      const res = await fetch('/api/lobby/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.capReached) {
          capture(EVENTS.CAP_HIT, { surface: 'live_board', mode: 'online' })
          announceOutOfTickets('live_board')
        }
        setError(
          data?.capReached
            ? 'You are out of tickets. Grab a pack or wait for your next one.'
            : data?.error === 'that is your own lobby'
              ? 'That is your own lobby.'
              : 'No open debate found for that. Check the code or pick another lobby.'
        )
        setJoining(null)
        return
      }
      router.push(`/dashboard/lobby/${data.lobbyId}`)
    } catch {
      setError('Could not reach the server. Try again.')
      setJoining(null)
    }
  }

  return (
    <>
      {/* ── The deck ────────────────────────────────────────────────
          State-dependent, which is the whole point of a command deck: if you
          are already hosting, the only thing that matters is getting back to
          your lobby. Otherwise the deck is the join surface. Exactly one
          bezel-deck on the screen either way. */}
      {myOpenLobbyId ? (
        <Link
          href={`/dashboard/lobby/${myOpenLobbyId}`}
          className="reveal r2 lift press bezel bezel-deck mt-8 flex items-center justify-between gap-4 px-6 py-5"
        >
          <div>
            <p className="flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.3em] text-blaze-bright">
              <span
                className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-blaze-bright"
                aria-hidden
              />
              YOUR LOBBY IS OPEN
            </p>
            <p className="mt-1.5 text-sm text-chalk-3">
              Waiting on challengers. Tap to manage requests or share your code.
            </p>
          </div>
          <span className="shrink-0 font-mono text-[11px] font-bold tracking-widest text-blaze-bright">
            MANAGE
          </span>
        </Link>
      ) : (
        <div className="reveal r2 bezel bezel-deck mt-8 grid gap-0 md:grid-cols-2">
          <form
            className="p-6"
            onSubmit={(e) => {
              e.preventDefault()
              if (code.trim()) void join({ code: code.trim() }, 'code')
            }}
          >
            <label
              htmlFor="lobby-code"
              className="font-mono text-[10px] font-bold tracking-[0.3em] text-chalk-3"
            >
              GOT A CODE?
            </label>
            <div className="mt-3 flex items-center gap-3">
              <input
                id="lobby-code"
                name="code"
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                // An example, not the length: codes skip 0/O and 1/I/L, which
                // one look at a real one settles.
                placeholder="e.g. K7QX4M2P"
                value={code}
                maxLength={8}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="w-full min-w-0 rounded-card border border-line-strong bg-panel px-4 py-3 font-mono text-sm tracking-[0.25em] text-chalk placeholder:text-chalk-3 focus:border-blaze/60"
              />
              <Button
                type="submit"
                disabled={!code.trim() || joining === 'code'}
                aria-busy={joining === 'code'}
              >
                {joining === 'code' ? 'JOINING' : 'JOIN'}
              </Button>
            </div>
          </form>

          <div className="flex flex-col justify-center border-t border-line p-6 md:border-l md:border-t-0">
            <p className="font-mono text-[10px] font-bold tracking-[0.3em] text-chalk-3">
              NO CODE?
            </p>
            <div className="mt-3">
              <Link
                href="/dashboard/debate/new?opponent=online"
                className={buttonClasses('primary', 'lg', 'w-full justify-center')}
              >
                OPEN YOUR OWN LOBBY
              </Link>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-blaze-bright">
          {error}
        </p>
      )}

      {/* ── The board: ONE panel, divide-y rows ─────────────────────
          This replaced a bezel per lobby, which at 50 open rows was 50 nested
          double-bezels. .scanlines rides the container and ONLY when the count
          is above zero, so the texture appears exactly when something is
          happening rather than decorating an empty room. */}
      <section className="reveal r3 mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-mono text-xs font-bold tracking-[0.3em] text-chalk-3">
            OPEN LOBBIES
          </h2>
          <p className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest tabular-nums text-chalk-3">
            {lobbies.length > 0 && (
              <span
                className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-blaze-bright"
                aria-hidden
              />
            )}
            {lobbies.length} LIVE
          </p>
        </div>

        {lobbies.length === 0 ? (
          // Before launch this is the common case for months. It used to offer
          // the same move as the card above it, which only pays off if you have
          // someone to text right now; these two always work.
          <div className="mt-4">
            <p className="text-sm text-chalk-3">
              Nobody&apos;s in a lobby right now. Open one above, or play right now:
            </p>
            <div className="bezel mt-3 divide-y divide-line overflow-hidden">
              <Link
                href="/dashboard/debate/new?opponent=ai"
                className="flex min-h-[64px] items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-panel-hi"
              >
                <span>
                  <span className="block font-semibold text-chalk">Debate the AI</span>
                  <span className="block text-[13px] text-chalk-3">1 ticket · about ten minutes</span>
                </span>
                <CaretRight size={16} weight="bold" aria-hidden className="shrink-0 text-blaze-bright" />
              </Link>
              <Link
                href="/dashboard/daily"
                className="flex min-h-[64px] items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-panel-hi"
              >
                <span>
                  <span className="block font-semibold text-chalk">Today&apos;s Daily</span>
                  <span className="block text-[13px] text-chalk-3">Free · one take, scored by the judge</span>
                </span>
                <CaretRight size={16} weight="bold" aria-hidden className="shrink-0 text-blaze-bright" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="scanlines bezel relative mt-4 overflow-hidden">
            <ul className="relative z-10 divide-y divide-line">
              {lobbies.map((l) => {
                const isMine = l.hostId === myUserId
                const isPending = myPendingLobbyIds.includes(l.id)
                const left = now === null ? null : minsLeft(l.createdAt, now)
                return (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-panel-hi"
                  >
                    {/* Full width on phones so the button drops under it; beside
                        it the meta line had a third of the row and broke "14-7"
                        across two lines. */}
                    <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                      {/* Wraps instead of truncating: at 375px every line used
                          to cut off ("RANDOM MATC...", "TOPIC REVE..."). */}
                      <p className="line-clamp-2 font-athletic text-lg font-black uppercase leading-tight tracking-tight">
                        {l.topicSource === 'custom' ? l.topicText : 'Random matchup'}
                      </p>
                      <p className="mt-1 text-[13px] leading-snug text-chalk-3">
                        {l.topicSource === 'custom'
                          ? `You'd argue: ${l.guestSide ?? ''}`
                          : `${DIFFICULTY_NAME[l.difficulty as Difficulty] ?? 'Starter'} depth · topic revealed at tip-off · sides flipped`}
                      </p>
                      <p className="mt-1 text-[13px] leading-snug text-chalk-3">
                        <span className="font-semibold text-chalk-2">{l.host.username}</span> ·{' '}
                        <span className="whitespace-nowrap">{NUM.format(l.host.points)} pts</span> ·{' '}
                        <span className="whitespace-nowrap">{l.host.wins}-{l.host.losses}</span> ·{' '}
                        <span className="whitespace-nowrap">{fmtClock(l.turnSeconds)} turns</span>
                        {/* A closing window, not an age. "41 min ago" invites you
                            to ignore it; "expires in 19 min" does not. Rendered
                            only after mount so the server never emits a clock. */}
                        {left !== null && (
                          <>
                            {' · '}
                            <span className={`whitespace-nowrap ${left <= 10 ? 'text-blaze-bright' : ''}`}>
                              expires in {left} min
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    {isMine ? (
                      <Link
                        href={`/dashboard/lobby/${l.id}`}
                        className={buttonClasses('secondary', 'sm', 'w-full sm:w-auto')}
                      >
                        MANAGE
                      </Link>
                    ) : isPending ? (
                      <Link
                        href={`/dashboard/lobby/${l.id}`}
                        className={buttonClasses('secondary', 'sm', 'w-full sm:w-auto')}
                      >
                        REQUESTED · VIEW
                      </Link>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="w-full sm:w-auto"
                        disabled={joining === l.id}
                        aria-busy={joining === l.id}
                        onClick={() => void join({ lobbyId: l.id }, l.id)}
                      >
                        {/* It files a request the host can decline, which is
                            what the next screen calls it too. */}
                        {joining === l.id ? 'ASKING…' : 'ASK TO JOIN'}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </section>
    </>
  )
}
