import Link from 'next/link'
import { redirect } from 'next/navigation'
import { supabaseAdmin, supabaseServer } from '@/lib/supabase-server'
import { DAILY_WIN_BONUS, applyFounding } from '@/lib/debate'
import { buttonClasses } from '@/components/ui/button'
import PageHeader from '@/components/page-header'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  username: string
  points: number
  wins: number
  losses: number
}

// Monday 00:00 UTC, the same week boundary Postgres's date_trunc('week') uses.
function weekStartUTC(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d
}

// This week (UX audit J2, 2026-10-10). Career points only ever go up, so
// whoever plays first is permanently ahead of anyone who joins in month two,
// and a board where nothing moves is not a reason to come back. The week is
// worked out from what is already stored, nothing new: points_earned on each
// seat of every debate started since Monday, plus the Daily's +300 for each
// day won. Read with the service role because debates are RLS-scoped to their
// two seats; only usernames, sums and records leave this function, the same
// things the career board already shows. Mid-debate profanity deductions live
// only on the profile, so they are not in the week's sum.
async function weeklyRows(): Promise<Row[]> {
  const admin = supabaseAdmin()
  const since = weekStartUTC(new Date()).toISOString()
  const [{ data: debates }, { data: crowns }] = await Promise.all([
    admin
      .from('debates')
      .select('user_id, opponent_user_id, opponent, winner, points_earned, opponent_points_earned')
      .eq('status', 'complete')
      .gte('created_at', since)
      .limit(5000),
    admin.from('daily_prompts').select('winner_user_id').gte('awarded_at', since),
  ])

  const tally = new Map<string, { points: number; wins: number; losses: number }>()
  const add = (id: string, points: number, won: boolean | null) => {
    const t = tally.get(id) ?? { points: 0, wins: 0, losses: 0 }
    t.points += points
    if (won === true) t.wins += 1
    if (won === false) t.losses += 1
    tally.set(id, t)
  }
  for (const d of debates ?? []) {
    // A same-phone exhibition moves no points and counts for no one.
    if (d.opponent === 'human' && !d.opponent_user_id) continue
    const decided = d.winner === 'user' || d.winner === 'opponent'
    add(d.user_id, d.points_earned ?? 0, decided ? d.winner === 'user' : null)
    if (d.opponent_user_id) {
      add(d.opponent_user_id, d.opponent_points_earned ?? 0, decided ? d.winner === 'opponent' : null)
    }
  }

  const crownIds = (crowns ?? []).map((c) => c.winner_user_id).filter((id): id is string => Boolean(id))
  const ids = [...new Set([...tally.keys(), ...crownIds])]
  if (ids.length === 0) return []
  const { data: profiles } = await admin.from('profiles').select('id, username, is_founding').in('id', ids)
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]))
  for (const id of crownIds) {
    add(id, applyFounding(DAILY_WIN_BONUS, Boolean(byId.get(id)?.is_founding)), null)
  }

  return ids
    .map((id) => ({ id, username: (byId.get(id)?.username as string) ?? 'baller', ...tally.get(id)! }))
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?next=/dashboard/leaderboard')

  const { view: viewParam } = await searchParams
  const view: 'week' | 'all' = viewParam === 'all' ? 'all' : 'week'

  // Rank only players with points (UX audit J1). Every account used to be
  // ranked, so the podium could crown three accounts on 0 and a new account
  // read "11 ballers ranked" with two of them never having played.
  const [{ count: totalPlayers }, ranked] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    view === 'week'
      ? weeklyRows()
      : supabase
          .from('profiles')
          .select('id, username, points, wins, losses')
          .gt('points', 0)
          .order('points', { ascending: false })
          .order('wins', { ascending: false })
          .limit(100)
          .then(({ data }) => (data ?? []) as Row[]),
  ])

  const rows = ranked.slice(0, 100)
  const unscored = Math.max(0, (totalPlayers ?? 0) - ranked.length)
  const inTop = rows.some((r) => r.id === user.id)

  // Outside the top 100 on the career board: a true rank from a count. On the
  // weekly board everyone with points is already in `ranked`.
  let myRank: number | null = null
  let myRow: Row | null = null
  if (inTop) {
    myRow = rows.find((r) => r.id === user.id) ?? null
    myRank = rows.findIndex((r) => r.id === user.id) + 1
  } else if (view === 'all') {
    const { data: me } = await supabase
      .from('profiles')
      .select('id, username, points, wins, losses')
      .eq('id', user.id)
      .single()
    if (me && me.points > 0) {
      myRow = me as Row
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gt('points', me.points)
      myRank = (count ?? 0) + 1
    }
  } else {
    const at = ranked.findIndex((r) => r.id === user.id)
    if (at >= 0) {
      myRow = ranked[at]
      myRank = at + 1
    }
  }

  const podium = rows.slice(0, 3)
  const rest = rows.slice(3)

  return (
    <>
      <PageHeader
        eyebrow="THE BOARD"
        title={<>Who&apos;s got next.</>}
        stat={ranked.length > 0 ? `${ranked.length.toLocaleString('en-US')} RANKED` : undefined}
      />

      {/* Links rather than buttons: each view is its own URL, so it can be
          shared and the back button does what people expect. */}
      <nav aria-label="Board" className="reveal r2 mt-6 flex gap-1.5 rounded-card border border-line bg-ink/40 p-1.5 sm:max-w-sm">
        {([
          ['week', 'This week', '/dashboard/leaderboard'],
          ['all', 'All time', '/dashboard/leaderboard?view=all'],
        ] as const).map(([key, label, href]) => (
          <Link
            key={key}
            href={href}
            aria-current={view === key ? 'page' : undefined}
            className={`inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[11px] text-sm font-semibold transition-colors ${
              view === key ? 'bg-steel text-chalk ring-1 ring-blaze' : 'text-chalk-3 hover:text-chalk'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-sm text-chalk-3">
        {view === 'week'
          ? 'Points won since Monday. Everyone starts the week at zero.'
          : 'Every point since the day you joined.'}
      </p>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
          <p className="font-athletic text-2xl font-black uppercase tracking-tight text-chalk">
            {view === 'week' ? 'Nobody has scored this week' : "The board's open"}
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-chalk-3">
            Win a debate and you&apos;re the one everyone else is chasing.
          </p>
          <Link
            href="/dashboard/debate/new"
            className={buttonClasses('primary', 'md', 'mt-6')}
          >
            Put yourself on it
          </Link>
        </div>
      ) : (
        <>
          {/* ── The podium is this screen's deck ─────────────────────
              One bezel-deck, one grid-texture, and .text-stroke returns on
              the rank numerals, which is exactly the job the landing gives
              it (a decorative numeral, never a headline word). 6/3/3 so
              first place is unmistakably first rather than one of three
              equal cards. */}
          <section className="reveal r2 mt-8">
            <div className="bezel bezel-deck relative overflow-hidden p-6 md:p-8">
              <div className="grid-texture absolute inset-0" aria-hidden />
              <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-12">
                {podium.map((r, i) => {
                  const isMe = r.id === user.id
                  const first = i === 0
                  return (
                    <div
                      key={r.id}
                      className={
                        first
                          ? 'lg:col-span-6'
                          : 'lg:col-span-3 lg:border-l lg:border-line lg:pl-6'
                      }
                    >
                      <p className="flex items-baseline gap-3">
                        <span
                          className={`font-athletic font-black leading-none tabular-nums text-stroke ${
                            first ? 'text-5xl md:text-6xl' : 'text-3xl md:text-4xl'
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span
                          className={`min-w-0 truncate font-athletic font-black uppercase tracking-tight ${
                            first ? 'text-2xl md:text-3xl' : 'text-lg'
                          } ${isMe ? 'text-blaze-bright' : 'text-chalk'}`}
                        >
                          {r.username}
                        </span>
                      </p>
                      <p className="mt-2 font-mono text-[11px] tracking-[0.25em] text-chalk-3">
                        <span className="font-bold tabular-nums text-chalk-2">
                          {r.points.toLocaleString()}
                        </span>{' '}
                        PTS
                        <span aria-hidden className="text-chalk-3">
                          {' · '}
                        </span>
                        <span className="tabular-nums">
                          {r.wins}-{r.losses}
                        </span>
                        {isMe && (
                          <span className="ml-2 font-bold text-blaze-bright">YOU</span>
                        )}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          {/* ── Ranks 4 and below: one panel, divide-y rows ──────────
              .bezel is a panel treatment, never a row treatment. */}
          {rest.length > 0 && (
            <section className="reveal r3 mt-6">
              <div className="bezel overflow-hidden">
                {/* A real table: rank / name / record / points is tabular
                    data, and a grid of divs gives a screen reader no column
                    association at all. table-fixed keeps the grid look. */}
                <table className="w-full table-fixed border-collapse">
                  <caption className="sr-only">Career leaderboard, ranks 4 and below</caption>
                  <thead>
                    <tr className="border-b border-line">
                      {/* Column widths are phone-first. table-fixed honours
                          every declared width and gives the NAME whatever is
                          left, so desktop widths here cost the one column that
                          holds variable-length content. At 375px the table is
                          333px wide (viewport minus the hub's px-5); the old
                          w-14 / w-24 / w-28 took 264px of it and left the name
                          about 53px, or six characters of a username the schema
                          allows to be twenty. RECORD drops below sm because it
                          is already on the deck and on the podium, which buys
                          the name roughly 150px instead. */}
                      <th scope="col" className="w-10 px-3 py-3 text-left font-mono text-[10px] font-bold tracking-[0.25em] text-chalk-3 sm:w-14 sm:px-5">#</th>
                      <th scope="col" className="px-2 py-3 text-left font-mono text-[10px] font-bold tracking-[0.25em] text-chalk-3">BALLER</th>
                      <th scope="col" className="hidden w-24 px-2 py-3 text-right font-mono text-[10px] font-bold tracking-[0.25em] text-chalk-3 sm:table-cell">RECORD</th>
                      <th scope="col" className="w-20 px-3 py-3 text-right font-mono text-[10px] font-bold tracking-[0.25em] text-chalk-3 sm:w-28 sm:px-5">POINTS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rest.map((r, i) => {
                      const isMe = r.id === user.id
                      return (
                        <tr
                          key={r.id}
                          aria-current={isMe ? 'true' : undefined}
                          className={`transition-colors hover:bg-panel-hi ${isMe ? 'bg-steel/25' : ''}`}
                        >
                          <td className="px-3 py-3 font-athletic text-xl font-black tabular-nums text-chalk-3 sm:px-5">
                            {i + 4}
                          </td>
                          {/* Truncation moved OFF the cell and onto the name
                              alone. With `truncate` on the <td>, the YOU tag was
                              the last child of a nowrap cell, so the ellipsis
                              ate the tag before it ate the name: on a phone you
                              lost your own marker and the username at once. */}
                          <td className="px-2 py-3">
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className={`truncate ${isMe ? 'font-semibold text-chalk' : 'text-chalk-2'}`}
                              >
                                {r.username}
                              </span>
                              {isMe && (
                                <span className="shrink-0 font-mono text-[10px] font-bold tracking-widest text-blaze-bright">
                                  YOU
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="hidden px-2 py-3 text-right font-mono text-sm tabular-nums text-chalk-3 sm:table-cell">
                            {r.wins}-{r.losses}
                          </td>
                          <td className="px-3 py-3 text-right font-athletic text-xl font-black tabular-nums text-chalk sm:px-5">
                            {r.points.toLocaleString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── Your rank, pinned ────────────────────────────────────
              Sticky so you never scroll 100 rows to find yourself, and z-30 so
              it sits under the tab bar (z-50) rather than fighting it. Rendered
              for everyone, not only people outside the top 100.

              The bottom offset TRACKS the tab bar rather than guessing at it.
              The bar is 56px plus env(safe-area-inset-bottom), so a flat 72px
              clears it on a device with no home indicator and overlaps it on one
              that has: measured at 768px with a 34px inset, an 11px overlap.
              4.5rem plus the same inset holds a constant 16px gap at both. */}
          {myRow && myRank && (
            <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mt-6 lg:bottom-4">
              {/* Deliberately NOT bezel-deck. The plan specified one, but the
                  podium above is already this screen's deck, and two red-glowing
                  surfaces on one screen spends the signal that makes either of
                  them mean anything. A blaze border reads as "this row is yours"
                  without competing for the hero slot. */}
              <div className="bezel grid grid-cols-[3rem_1fr_auto_auto] items-center gap-4 border-blaze/40 bg-panel-hi/95 px-5 py-4 backdrop-blur-sm">
                <span className="font-athletic text-xl font-black tabular-nums text-blaze-bright">
                  {myRank}
                </span>
                <span className="truncate">
                  <span className="font-semibold text-chalk">{myRow.username}</span>
                  <span className="ml-2 font-mono text-[10px] font-bold tracking-widest text-blaze-bright">
                    YOU
                  </span>
                </span>
                <span className="text-right font-mono text-sm tabular-nums text-chalk-3">
                  {myRow.wins}-{myRow.losses}
                </span>
                <span className="text-right font-athletic text-xl font-black tabular-nums text-chalk">
                  {myRow.points.toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {unscored > 0 && (
        <p className="mt-6 text-center text-sm text-chalk-3">
          {unscored.toLocaleString('en-US')} more {unscored === 1 ? "player hasn't" : "players haven't"} scored
          {view === 'week' ? ' this week' : ' yet'}
          {!myRow ? ', you included. One win puts you on it.' : '.'}
        </p>
      )}
    </>
  )
}
