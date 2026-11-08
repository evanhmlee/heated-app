import Link from 'next/link'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase-server'
import BadgeChip from '@/components/badge-chip'
import { buttonClasses } from '@/components/ui/button'
import {
  BADGES,
  FOUNDING_BADGE_SLUG,
  DAILY_ELITE_SCORE,
  badgeProgress,
  maxTierFor,
  type BadgeStats,
} from '@/lib/badges'
import { debateOpenState } from '@/lib/debate'

// The full record (UX audit E5, 2026-10-10). The Locker room's list stopped at
// the last six debates, so debate seven was unreachable from any screen, and a
// Daily take was gone the day after it was played. This page has every debate,
// every Daily take, and the badge grid that used to sit collapsed on the deck.

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const DEBATE_LIMIT = 100
const TAKE_LIMIT = 60

export const metadata = { title: 'Your record · Heated' }

export default async function HistoryPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?next=/dashboard/history')

  const [
    { data: profile },
    { data: debates, error: debatesError },
    { data: takes, error: takesError },
    { data: earned },
    { count: dailyTakeCount },
    { count: dailyEliteCount },
    { count: dailyCrownCount },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('points, wins, losses, best_streak, h2h_wins')
      .eq('id', user.id)
      .single(),
    supabase
      .from('debates')
      .select('id, topic_text, status, winner, user_score, opponent_score, user_id, opponent_user_id, opponent, versus, created_at, updated_at')
      .or(`user_id.eq.${user.id},opponent_user_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(DEBATE_LIMIT),
    supabase
      .from('daily_attempts')
      .select('id, score, side, created_at, daily_prompts(topic, prompt_date)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(TAKE_LIMIT),
    supabase.from('user_badges').select('tier, badges(slug)').eq('user_id', user.id),
    // A count, not takes.length: the list stops at TAKE_LIMIT and badge
    // progress must not.
    supabase
      .from('daily_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('daily_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('score', DAILY_ELITE_SCORE),
    supabase
      .from('daily_prompts')
      .select('id', { count: 'exact', head: true })
      .eq('winner_user_id', user.id),
  ])

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()

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
  const foundingBadge = BADGES.find((b) => b.slug === FOUNDING_BADGE_SLUG)
  const badgeStats: BadgeStats = {
    wins: profile?.wins ?? 0,
    bestStreak: profile?.best_streak ?? 0,
    points: profile?.points ?? 0,
    decidedDebates: (profile?.wins ?? 0) + (profile?.losses ?? 0),
    h2hWins: profile?.h2h_wins ?? 0,
    dailyTakes: dailyTakeCount ?? 0,
    dailyHighScores: dailyEliteCount ?? 0,
    dailyCrowns: dailyCrownCount ?? 0,
  }
  // Earned first, highest tier first, then the rest in catalog order.
  const sortedBadges = [...earnableBadges].sort((a, b) => {
    const ta = tierBySlug.get(a.slug) ?? 0
    const tb = tierBySlug.get(b.slug) ?? 0
    if (ta !== tb) return tb - ta
    return earnableBadges.indexOf(a) - earnableBadges.indexOf(b)
  })

  const wins = profile?.wins ?? 0
  const losses = profile?.losses ?? 0

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <p className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-blaze-bright">YOUR RECORD</p>
        <h1 className="mt-2 font-athletic text-3xl font-black uppercase leading-none tracking-tight md:text-4xl">
          {wins}-{losses}
        </h1>
        <p className="mt-3 text-chalk-2">
          {wins} {wins === 1 ? 'win' : 'wins'}, {losses} {losses === 1 ? 'loss' : 'losses'},{' '}
          {(profile?.points ?? 0).toLocaleString('en-US')} points.
        </p>
      </header>

      {/* ── Debates ── */}
      <section aria-labelledby="debates-heading" className="mt-8">
        <h2 id="debates-heading" className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-chalk-3">
          DEBATES
        </h2>
        {debatesError ? (
          <p className="bezel mt-3 p-5 text-sm text-chalk-3">Could not load your debates. Refresh to try again.</p>
        ) : !debates || debates.length === 0 ? (
          <div className="bezel mt-3 p-6">
            <p className="font-semibold text-chalk">No debates yet.</p>
            <p className="mt-1 text-sm text-chalk-3">Your record starts with your first one.</p>
            <Link href="/dashboard/debate/new" className={buttonClasses('primary', 'md', 'mt-4')}>
              Start a debate
            </Link>
          </div>
        ) : (
          <ul className="bezel mt-3 divide-y divide-line overflow-hidden">
            {debates.map((d) => {
              const asGuest = d.opponent_user_id === user.id
              const won = asGuest ? d.winner === 'opponent' : d.winner === 'user'
              const lost = asGuest ? d.winner === 'user' : d.winner === 'opponent'
              const myScore = asGuest ? d.opponent_score : d.user_score
              const theirScore = asGuest ? d.user_score : d.opponent_score
              const done = d.status === 'complete'
              const expired = debateOpenState(d.status, d.updated_at, nowMs) === 'expired'
              const against =
                d.opponent === 'ai'
                  ? 'vs the AI'
                  : d.opponent_user_id
                    ? 'ranked'
                    : `vs ${(d.versus as { guest_name?: string } | null)?.guest_name?.trim() || 'a friend'}`
              return (
                <li key={d.id}>
                  <Link
                    href={expired ? `/dashboard/debate/new?rerun=${d.id}` : `/dashboard/debate/${d.id}`}
                    className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-3 px-5 py-3.5 transition-colors hover:bg-panel-hi"
                  >
                    <span
                      className={`font-athletic text-lg font-black leading-tight ${
                        done && won ? 'text-blaze-bright' : 'text-chalk-3'
                      }`}
                    >
                      {done ? (won ? 'W' : lost ? 'L' : 'D') : '·'}
                      <span className="sr-only">
                        {done ? (won ? 'Won.' : lost ? 'Lost.' : 'Draw.') : expired ? 'Unfinished.' : 'Still open.'}
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-[15px] leading-snug text-chalk">{d.topic_text}</span>
                      <span className="mt-0.5 block text-[13px] text-chalk-3">
                        {DATE.format(new Date(d.created_at))} · {against}
                      </span>
                    </span>
                    <span className="pt-0.5 text-[13px] tabular-nums text-chalk-3">
                      {done ? `${myScore}-${theirScore}` : expired ? 'Unfinished' : (
                        <span className="font-semibold text-blaze-bright">Resume</span>
                      )}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── Daily takes ── */}
      <section aria-labelledby="takes-heading" className="mt-10">
        <h2 id="takes-heading" className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-chalk-3">
          DAILY TAKES
        </h2>
        {takesError ? (
          <p className="bezel mt-3 p-5 text-sm text-chalk-3">Could not load your Daily takes. Refresh to try again.</p>
        ) : !takes || takes.length === 0 ? (
          <div className="bezel mt-3 p-6">
            <p className="font-semibold text-chalk">No Daily takes yet.</p>
            <p className="mt-1 text-sm text-chalk-3">One a day, free, no ticket. Top score wins +300.</p>
            <Link href="/dashboard/daily" className={buttonClasses('secondary', 'md', 'mt-4')}>
              Play today&apos;s Daily
            </Link>
          </div>
        ) : (
          <ul className="bezel mt-3 divide-y divide-line overflow-hidden">
            {takes.map((t) => {
              const prompt = (Array.isArray(t.daily_prompts) ? t.daily_prompts[0] : t.daily_prompts) as
                | { topic?: string; prompt_date?: string }
                | null
              const day = prompt?.prompt_date ? new Date(`${prompt.prompt_date}T12:00:00Z`) : new Date(t.created_at)
              return (
                <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-5 py-3.5">
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-[15px] leading-snug text-chalk">
                      {prompt?.topic ?? 'Daily question'}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-chalk-3">
                      {DATE.format(day)}
                      {t.side ? ` · you argued ${t.side}` : ''}
                    </span>
                  </span>
                  <span className="font-athletic text-xl font-black tabular-nums text-chalk">{t.score}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── Badges ── */}
      <section id="badges" aria-labelledby="badges-heading" className="mt-10 scroll-mt-24">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="badges-heading" className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-chalk-3">
            BADGES
          </h2>
          <p className="text-[13px] text-chalk-3">
            {earnedLevels} of {totalLevels} tiers
          </p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {foundingBadge && tierBySlug.has(FOUNDING_BADGE_SLUG) && (
            <BadgeChip slug={foundingBadge.slug} tier={1} />
          )}
          {sortedBadges.map((b) => (
            <BadgeChip
              key={b.slug}
              slug={b.slug}
              tier={tierBySlug.get(b.slug) ?? 0}
              progress={badgeProgress(b, badgeStats)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
