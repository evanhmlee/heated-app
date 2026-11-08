import Link from 'next/link'
import { createServerClient } from '@supabase/ssr'
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import PurchaseConfirmation from '@/components/purchase-confirmation'
import { DeckWallet, DeckStakeLine, ProNudge } from '@/components/deck-cells'
import { BADGE_ICONS } from '@/components/badge-chip'
import { BADGES, FOUNDING_BADGE_SLUG, maxTierFor, tierLabel } from '@/lib/badges'
import { buttonClasses } from '@/components/ui/button'
import {
  DIFFICULTY_NAME,
  LOBBY_TTL_MINUTES,
  ROUND_ORDER,
  applyFounding,
  debateOpenState,
  lobbyFreshCutoffISO,
  nextTurn,
  pointsDelta,
  resumeTimeLeft,
  type Difficulty,
  type RoundEntry,
} from '@/lib/debate'
import { CaretRight, SealCheck } from '@phosphor-icons/react/dist/ssr'

// The Locker room (UX audit E, 2026-10-10).
//
// A brand-new account used to open on "STARTER WIN PAYS +226", four zeros and
// "0 OF 35 TIERS", with nothing saying what a debate is, what a ticket buys, or
// that the Daily is free. It now gets a first-debate card that says exactly
// that, and the card goes away after the first debate.
//
// For everyone else: the deck (Start, tickets, what a win pays, four stats),
// then the Pro card for Free accounts, the Daily with its whole question, the
// Live card, and the record with "See all". On laptops the Pro card and a
// compact badge line share the record's row instead of leaving an empty box.
// The full badge grid lives on /dashboard/history.

export default async function DashboardPage() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // Server components can't write cookies; the proxy handles refresh.
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Every read below destructures `error` where it feeds a claim about other
  // people. A failed lobby query that fell back to `?? 0` would render
  // "Nobody's in a lobby" as a confident falsehood.
  const today = new Date().toISOString().slice(0, 10)

  const [
    { data: profile },
    { data: recentDebates },
    { data: earned },
    { data: dailyPrompt },
    { data: openLobbies, count: lobbyCount, error: lobbyError },
    { data: resumable },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('points, wins, losses, current_streak, best_streak, is_pro, is_founding')
      .eq('id', user.id)
      .single(),
    // Both seats: an online ranked match you joined is as much yours as one
    // you hosted. Scores are stored HOST-first, so the list flips them for a
    // guest (see the perspective flip below).
    supabase
      .from('debates')
      .select('id, topic_text, status, winner, user_score, opponent_score, user_id, opponent_user_id, difficulty, created_at, updated_at')
      .or(`user_id.eq.${user.id},opponent_user_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase.from('user_badges').select('tier, badges(slug)').eq('user_id', user.id),
    // Read-only. /dashboard/daily owns generation, so this page never blocks
    // on an Anthropic call.
    supabase.from('daily_prompts').select('id, topic').eq('prompt_date', today).maybeSingle(),
    // Somebody ELSE's lobby. Without the host filter the most likely non-zero
    // state this card could render was your own lobby, in the third person.
    supabase
      .from('lobbies')
      .select('id, created_at, host:profiles!lobbies_host_id_fkey(username)', { count: 'exact' })
      .eq('status', 'open')
      .eq('is_listed', true)
      .neq('host_id', user.id)
      .gte('created_at', lobbyFreshCutoffISO())
      .order('created_at', { ascending: false })
      .limit(1),
    // The one debate the viewer can still finish. Fetched on its own because
    // deciding whether a row is worth resuming needs `rounds`.
    supabase
      .from('debates')
      .select('id, topic_text, rounds, mode, opponent, status, updated_at')
      .or(`user_id.eq.${user.id},opponent_user_id.eq.${user.id}`)
      .in('status', ['arguing', 'transcribing', 'judging'])
      .order('updated_at', { ascending: false })
      .limit(1),
  ])

  const myPoints = profile?.points ?? 0

  const [{ count: aheadOfMe, error: rankError }, { data: myTake }, { count: dailyTakes, error: takesError }] =
    await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gt('points', myPoints),
      dailyPrompt
        ? supabase
            .from('daily_attempts')
            .select('score')
            .eq('daily_prompt_id', dailyPrompt.id)
            .eq('user_id', user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      dailyPrompt
        ? supabase
            .from('daily_attempts')
            .select('id', { count: 'exact', head: true })
            .eq('daily_prompt_id', dailyPrompt.id)
        : Promise.resolve({ count: 0, error: null }),
    ])

  // Your place on today's board, once you have a take in.
  const { count: aheadOnDaily } =
    dailyPrompt && myTake
      ? await supabase
          .from('daily_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('daily_prompt_id', dailyPrompt.id)
          .gt('score', (myTake as { score: number }).score)
      : { count: null }

  const myDailyScore = myTake ? (myTake as { score: number }).score : null
  const myDailyRank = myDailyScore !== null && aheadOnDaily !== null ? aheadOnDaily + 1 : null
  const takesToday = takesError ? null : (dailyTakes ?? 0)
  const lobbiesOpen = lobbyError ? null : (lobbyCount ?? 0)
  const rank = rankError ? null : (aheadOfMe ?? 0) + 1
  const isFounding = Boolean(profile?.is_founding)
  const firstRun = (recentDebates ?? []).length === 0

  const freshest = openLobbies?.[0]
  const freshestHost = freshest?.host as { username?: string } | { username?: string }[] | undefined
  const hostName = Array.isArray(freshestHost) ? freshestHost[0]?.username : freshestHost?.username
  // Request-time clock: a dynamic server component renders once per request,
  // and "minutes left on a 60 minute lobby" means nothing except relative to now.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  const minutesLeft = freshest
    ? Math.max(0, LOBBY_TTL_MINUTES - Math.floor((nowMs - new Date(freshest.created_at).getTime()) / 60000))
    : 0

  // A debate is worth resuming only once a turn is in it; past its 24-hour
  // window it lives in the record as unfinished instead.
  const openDebate = (() => {
    const row = resumable?.[0]
    if (!row) return null
    const rounds = (row.rounds ?? []) as RoundEntry[]
    if (rounds.length === 0) return null
    if (debateOpenState(row.status as string, row.updated_at as string, nowMs) !== 'resumable') return null
    const turn = nextTurn(rounds)
    return {
      id: row.id as string,
      topic: row.topic_text as string,
      roundNumber: turn ? ROUND_ORDER.indexOf(turn.round) + 1 : ROUND_ORDER.length,
      awaitingVerdict: turn === null,
      timeLeft: resumeTimeLeft(row.updated_at as string, nowMs),
    }
  })()

  // What a win is worth at the difficulty they last played, so the number is
  // theirs rather than a brochure figure, with the random bonus and the
  // founder boost they would actually be paid.
  const lastDifficulty = ((recentDebates ?? []).find((d) => d.difficulty)?.difficulty ?? 'starter') as Difficulty
  const winPoints = applyFounding(pointsDelta('win', lastDifficulty, true), isFounding)

  const tierBySlug = new Map<string, number>()
  for (const row of earned ?? []) {
    const b = (row as { badges: unknown }).badges
    const arr = Array.isArray(b) ? b : b ? [b] : []
    const slug = (arr[0] as { slug?: string } | undefined)?.slug
    if (slug) tierBySlug.set(slug, (row as { tier?: number }).tier ?? 1)
  }
  const earnableBadges = BADGES.filter((b) => b.slug !== FOUNDING_BADGE_SLUG)
  const totalLevels = earnableBadges.reduce((n, b) => n + maxTierFor(b), 0)
  const earnedLevels = earnableBadges.reduce((n, b) => n + (tierBySlug.get(b.slug) ?? 0), 0)
  const nextBadge = earnableBadges.find((b) => (tierBySlug.get(b.slug) ?? 0) < maxTierFor(b))
  const nextBadgeTier = nextBadge ? (tierBySlug.get(nextBadge.slug) ?? 0) + 1 : 0

  const record = `${profile?.wins ?? 0}-${profile?.losses ?? 0}`
  const streak = profile?.current_streak ?? 0

  /* ── Cards ───────────────────────────────────────────────────── */

  const dailyCard = (
    <Link
      href="/dashboard/daily"
      className="lift press bezel flex h-full flex-col gap-3 p-6 md:p-7"
    >
      <p className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-blaze-bright">
        {myDailyScore === null ? 'THE DAILY · FREE, NO TICKET' : 'THE DAILY'}
      </p>
      <p className="text-lg font-bold leading-snug text-chalk md:text-[22px]">
        {dailyPrompt ? dailyPrompt.topic : "Today's question is on its way."}
      </p>
      <p className="mt-auto text-sm leading-relaxed text-chalk-3">
        {myDailyScore !== null ? (
          <span className="inline-flex items-center gap-1.5">
            <SealCheck size={15} weight="fill" aria-hidden className="text-blaze-bright" />
            <span className="font-semibold text-chalk">
              Your take is in: {myDailyScore}
              {myDailyRank !== null && `, #${myDailyRank} today`}.
            </span>
          </span>
        ) : (
          <>One take, scored by the judge. Top score today wins +300.</>
        )}{' '}
        {takesToday !== null && takesToday > 0 && myDailyScore === null && (
          <>
            {takesToday} {takesToday === 1 ? 'take' : 'takes'} in so far.
          </>
        )}
      </p>
      {myDailyScore === null && (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blaze-bright">
          Play the Daily
          <CaretRight size={14} weight="bold" aria-hidden />
        </span>
      )}
    </Link>
  )

  const liveCard = (
    <Link href="/dashboard/live" className="lift press bezel flex h-full flex-col gap-2.5 p-6 md:p-7">
      <p
        className={`flex items-center gap-2 font-mono text-[10.5px] font-bold tracking-[0.25em] ${
          lobbiesOpen ? 'text-blaze-bright' : 'text-chalk-3'
        }`}
      >
        {/* Pulses only when somebody is actually in there. */}
        {lobbiesOpen ? <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-blaze-bright" aria-hidden /> : null}
        LIVE · RANKED
      </p>
      {lobbiesOpen === null ? (
        <p className="text-lg font-bold text-chalk">Could not reach the lobbies.</p>
      ) : lobbiesOpen === 0 ? (
        <p className="text-lg font-bold text-chalk">Nobody&apos;s in a lobby right now.</p>
      ) : (
        <p className="text-lg font-bold text-chalk">
          {lobbiesOpen} {lobbiesOpen === 1 ? 'lobby is' : 'lobbies are'} open.
        </p>
      )}
      <p className="text-sm leading-relaxed text-chalk-3">
        {lobbiesOpen && hostName ? (
          <>
            <span className="text-chalk-2">{hostName}</span> is waiting, {minutesLeft} min left.{' '}
          </>
        ) : (
          <>Open one and send the code to a friend. </>
        )}
        A ranked win pays +{applyFounding(pointsDelta('win', 'all_star', false), isFounding)}.
      </p>
      <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-semibold text-blaze-bright">
        {lobbiesOpen ? 'See the lobbies' : 'Open a lobby'}
        <CaretRight size={14} weight="bold" aria-hidden />
      </span>
    </Link>
  )

  const badgeLine = (
    <Link
      href="/dashboard/history#badges"
      className="bezel flex items-center justify-between gap-4 p-5 transition-colors hover:bg-panel-hi"
    >
      <span className="min-w-0">
        <span className="block font-semibold text-chalk">
          Badges · {earnedLevels} of {totalLevels} tiers
        </span>
        {nextBadge && (
          <span className="mt-0.5 block text-[13px] text-chalk-3">
            Next: {nextBadge.name}
            {maxTierFor(nextBadge) > 1 && `, ${tierLabel(nextBadgeTier)}`}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {earnableBadges
          .filter((b) => (tierBySlug.get(b.slug) ?? 0) > 0)
          .slice(0, 3)
          .map((b) => {
            const Glyph = BADGE_ICONS[b.slug]
            return (
              <span
                key={b.slug}
                title={b.name}
                className="hidden h-8 w-8 items-center justify-center rounded-full border border-blaze/50 bg-steel sm:flex"
              >
                {Glyph && <Glyph size={15} weight="fill" className="text-chalk" />}
              </span>
            )
          })}
        <CaretRight size={16} weight="bold" aria-hidden className="text-blaze-bright" />
      </span>
    </Link>
  )

  return (
    <>
      {/* Renders nothing unless Stripe just sent them back. */}
      <Suspense fallback={null}>
        <PurchaseConfirmation />
      </Suspense>

      <h1 className="sr-only">Locker room</h1>

      {firstRun ? (
        /* ── FIRST VISIT ─────────────────────────────────────────── */
        <section className="grid gap-4 lg:grid-cols-12">
          <div className="reveal r1 rounded-card border border-blaze/45 bg-panel p-6 md:p-8 lg:col-span-7">
            <p className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-blaze-bright">
              WELCOME TO HEATED
            </p>
            <h2 className="mt-3 font-athletic text-3xl font-black uppercase leading-none tracking-tight md:text-4xl">
              Your first debate
            </h2>
            <p className="mt-4 max-w-xl leading-relaxed text-chalk-2">
              Three rounds against the AI: your case, your rebuttal, your close. About ten
              minutes, typed or out loud. The judge scores facts, logic and delivery, and checks
              the stats you name.
            </p>
            <Link
              href="/dashboard/debate/new"
              className={buttonClasses('primary', 'xl', 'mt-6 w-full sm:w-auto sm:px-12')}
            >
              Start your first debate
            </Link>
            <div className="mt-6 max-w-md">
              <DeckWallet isFounding={isFounding} />
            </div>
          </div>
          <div className="reveal r2 lg:col-span-5">{dailyCard}</div>
          <div className="reveal r3 lg:col-span-12">{liveCard}</div>
        </section>
      ) : (
        <>
          {/* ── THE DECK ──────────────────────────────────────────── */}
          <section className="reveal r1 overflow-hidden rounded-card border border-blaze/45 bg-panel">
            <div className="grid md:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)_minmax(0,380px)]">
              <div className="flex flex-col justify-center gap-3 p-6 md:p-7">
                {/* The debate you can still finish, above the button that would
                    spend another ticket. A secondary control on purpose: it
                    happens about once a month. */}
                {openDebate && (
                  <Link
                    href={`/dashboard/debate/${openDebate.id}`}
                    className="group -mx-1 flex items-center gap-3 rounded-card border border-blaze/40 bg-steel/25 px-4 py-3 transition-colors hover:border-blaze/70"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-blaze-bright">
                        {openDebate.awaitingVerdict
                          ? 'Waiting on the judge'
                          : `Round ${openDebate.roundNumber} of ${ROUND_ORDER.length} · ${openDebate.timeLeft} left`}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-chalk-2">{openDebate.topic}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-chalk-2 group-hover:text-chalk">
                      {openDebate.awaitingVerdict ? 'See it' : 'Finish'}
                    </span>
                    <CaretRight size={12} weight="bold" aria-hidden className="shrink-0 text-blaze-bright" />
                  </Link>
                )}
                <Link href="/dashboard/debate/new" className={buttonClasses('primary', 'xl', 'w-full')}>
                  START A DEBATE
                </Link>
                <p className="min-h-[2.75rem] text-sm leading-relaxed text-chalk-3">
                  <DeckStakeLine
                    winPoints={winPoints}
                    difficultyName={DIFFICULTY_NAME[lastDifficulty]}
                    streak={streak}
                    isFounding={isFounding}
                  />
                </p>
              </div>

              <div className="relative flex flex-col justify-center border-t border-line p-6 md:border-l md:border-t-0 md:p-7">
                <div className="grid-texture absolute inset-0" aria-hidden />
                <div className="relative">
                  <DeckWallet isFounding={isFounding} />
                </div>
              </div>

              <div className="grid grid-cols-4 divide-x divide-line border-t border-line md:col-span-2 lg:col-span-1 lg:grid-cols-2 lg:divide-y lg:border-l lg:border-t-0">
                {[
                  { label: 'POINTS', value: myPoints.toLocaleString('en-US'), href: '/dashboard/leaderboard', accent: false },
                  { label: 'RECORD', value: record, href: '/dashboard/history', accent: false },
                  { label: 'STREAK', value: `${streak}`, href: '/dashboard/history#badges', accent: streak >= 2 },
                  // A dash, not "#1", when the rank read failed.
                  { label: 'RANK', value: rank === null ? '--' : `#${rank}`, href: '/dashboard/leaderboard', accent: false },
                ].map((s) => (
                  <Link
                    key={s.label}
                    href={s.href}
                    className="group flex min-h-[76px] flex-col justify-center px-3 py-3 transition-colors hover:bg-panel-hi sm:px-5 lg:min-h-[84px]"
                  >
                    <p className="flex items-center gap-1 font-mono text-[9.5px] font-bold tracking-[0.2em] text-chalk-3 sm:text-[10px] sm:tracking-[0.25em]">
                      {s.label}
                      <CaretRight size={9} weight="bold" aria-hidden className="hidden text-chalk-3 group-hover:text-blaze-bright sm:block" />
                    </p>
                    <p
                      className={`mt-1.5 font-athletic text-2xl font-black leading-none tabular-nums sm:text-3xl lg:text-4xl ${
                        s.accent ? 'text-blaze-bright' : 'text-chalk'
                      }`}
                    >
                      {s.value}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          {/* Phones: the Pro card sits right under the deck. Laptops: it
              moves into the record row's right column (below). */}
          <div className="reveal r2 mt-4 lg:hidden">
            <ProNudge isFounding={isFounding} />
          </div>

          {/* ── TODAY ─────────────────────────────────────────────── */}
          <section className="reveal r2 mt-4 grid gap-4 lg:mt-6 lg:grid-cols-12">
            <h2 className="sr-only">Today</h2>
            <div className="lg:col-span-7">{dailyCard}</div>
            <div className="lg:col-span-5">{liveCard}</div>
          </section>

          {/* ── YOUR RECORD ───────────────────────────────────────── */}
          <section className="reveal r3 mt-4 grid gap-4 lg:mt-6 lg:grid-cols-12 lg:items-start">
            <div className="bezel overflow-hidden lg:col-span-7">
              <div className="flex h-12 items-center justify-between border-b border-line px-5">
                <h2 className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-chalk-3">YOUR RECORD</h2>
                <Link
                  href="/dashboard/history"
                  className="inline-flex min-h-[44px] items-center text-sm font-semibold text-blaze-bright hover:text-chalk"
                >
                  See all
                </Link>
              </div>
              <ul className="divide-y divide-line">
                {(recentDebates ?? []).map((d) => {
                  // Scores are stored from the HOST's side; read them inverted
                  // for a ranked match you joined, or a loss shows as a W.
                  const asGuest = d.opponent_user_id === user.id
                  const won = asGuest ? d.winner === 'opponent' : d.winner === 'user'
                  const lost = asGuest ? d.winner === 'user' : d.winner === 'opponent'
                  const myScore = asGuest ? d.opponent_score : d.user_score
                  const theirScore = asGuest ? d.user_score : d.opponent_score
                  const done = d.status === 'complete'
                  const expired = debateOpenState(d.status, d.updated_at, nowMs) === 'expired'
                  return (
                    <li key={d.id}>
                      <Link
                        href={expired ? `/dashboard/debate/new?rerun=${d.id}` : `/dashboard/debate/${d.id}`}
                        className="grid min-h-[60px] grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-3 px-5 py-3.5 transition-colors hover:bg-panel-hi"
                      >
                        <span
                          className={`font-athletic text-lg font-black leading-tight ${
                            done && won ? 'text-blaze-bright' : 'text-chalk-3'
                          }`}
                        >
                          {done ? (won ? 'W' : lost ? 'L' : 'D') : '·'}
                          <span className="sr-only">
                            {done
                              ? won
                                ? 'Won.'
                                : lost
                                  ? 'Lost.'
                                  : 'Draw.'
                              : expired
                                ? 'Unfinished. Run it again for a ticket.'
                                : 'Unfinished. Still open.'}
                          </span>
                        </span>
                        <span className="line-clamp-2 text-[15px] leading-snug text-chalk">{d.topic_text}</span>
                        {done ? (
                          <span className="pt-0.5 text-[13px] tabular-nums text-chalk-3">
                            {myScore}-{theirScore}
                          </span>
                        ) : expired ? (
                          <span className="pt-0.5 text-[13px] text-chalk-3">Unfinished</span>
                        ) : (
                          <span className="pt-0.5 text-[13px] font-semibold text-blaze-bright">Resume</span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="flex flex-col gap-4 lg:col-span-5">
              <div className="hidden lg:block">
                <ProNudge isFounding={isFounding} />
              </div>
              {badgeLine}
            </div>
          </section>
        </>
      )}
    </>
  )
}
