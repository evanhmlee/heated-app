import { notFound, redirect } from 'next/navigation'
import { supabaseAdmin, supabaseServer } from '@/lib/supabase-server'
import { isDeepDiveUnlocked, withDeepDive } from '@/lib/deep-dive'
import DebateArena from '@/components/debate-arena'
import VersusArena from '@/components/versus-arena'
import OnlineArena from '@/components/online-arena'
import Link from 'next/link'
import { buttonClasses } from '@/components/ui/button'
import {
  DEBATE_RESUME_WINDOW_HOURS,
  debateOpenState,
  type Verdict,
} from '@/lib/debate'

// Shown when an unfinished debate has aged out of its resume window. It is a
// full page rather than a banner over the arena because the arena is not safe
// to render here: mounting it arms a turn clock and a recorder for a debate
// that is closed.
function DebateClosed({ id, topic }: { id: string; topic: string }) {
  return (
    <div className="relative min-h-dvh bg-ink text-chalk">
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-5 py-16">
        <p className="font-mono text-xs tracking-[0.3em] text-chalk-3">UNFINISHED</p>
        <h1 className="mt-3 font-athletic text-[clamp(1.75rem,5vw,2.75rem)] font-black uppercase leading-[0.95] tracking-tight">
          {topic}
        </h1>
        <p className="mt-5 leading-relaxed text-chalk-2">
          This one sat longer than {DEBATE_RESUME_WINDOW_HOURS} hours, so it is in the
          books. You can run the same topic again from the top. That costs a ticket,
          the same as any debate.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={`/dashboard/debate/new?rerun=${id}`}
            className={buttonClasses('primary', 'lg')}
          >
            Run it again
          </Link>
          <Link href="/dashboard" className={buttonClasses('secondary', 'lg')}>
            Locker room
          </Link>
        </div>
      </main>
    </div>
  )
}

export default async function DebatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: debate } = await supabase
    .from('debates')
    .select('id, user_id, opponent_user_id, topic_text, user_side, mode, difficulty, is_random, status, rounds, verdict, user_score, opponent_score, winner, points_earned, opponent_points_earned, opponent, versus, share_revoked, share_receipts, share_name, updated_at')
    .eq('id', id)
    .single()

  if (!debate) notFound()

  // The resume window closes 24 hours after the last turn. Past that the arena
  // must not mount: it would hand back a live recorder and a running clock for
  // a debate that is already in the books, and any turn submitted would be
  // scored into a debate the record has closed. Deep links, browser history and
  // the back button all land here, so this is the gate rather than the deck's.
  // Server component, rendered per request: there is no re-render for the
  // clock to be unstable across. Same waiver the deck takes for its lobby
  // countdown, which is also a value that cannot be anything except relative
  // to now.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  if (debateOpenState(debate.status, debate.updated_at, nowMs) === 'expired') {
    return <DebateClosed id={debate.id} topic={debate.topic_text} />
  }

  // Deep Dive is a Pro perk, so the text is stripped HERE, on the server,
  // before it reaches the client bundle. Sending it down and hiding it with CSS
  // is a paywall anyone beats with dev tools.
  //
  // Effective Pro, not is_pro: the landing sells packs as "no subscription, and
  // they come with Pro turned on", so holding pack tickets unlocks it too. Same
  // rule as public.is_effective_pro() in the DB, kept in TS here because this is
  // a plain server read and an RPC round-trip buys nothing.
  const { data: viewer } = await supabase
    .from('profiles')
    .select('is_pro, purchased_tickets, is_founding')
    .eq('id', user.id)
    .single()
  const deepDiveUnlocked = isDeepDiveUnlocked(viewer)
  // The verdict quotes founder prices (Pro, the pack) and names the founder
  // boost in the points line, so it needs to know on a reopened debate too,
  // not only when the judge route has just said so.
  const isFounding = Boolean(viewer?.is_founding)

  // The row never holds the Deep Dive's prose (lib/deep-dive.ts); an unlocked
  // viewer gets it put back here, everyone else gets round + swing only.
  if (debate.verdict && deepDiveUnlocked) {
    debate.verdict = await withDeepDive(supabaseAdmin(), debate.id, debate.verdict as Verdict)
  }

  if (debate.opponent === 'human') {
    // Host username powers the Speaker One / Debater A display name. RLS admits
    // both seats of an online match (owner OR opponent), so this resolves for
    // whichever player is viewing.
    const { data: prof } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', debate.user_id)
      .single()
    const hostName = prof?.username ?? 'Speaker One'

    // Online ranked match (opponent_user_id is service-role-set): the live
    // video arena, with the viewer's seat derived server-side.
    if (debate.opponent_user_id) {
      return (
        <OnlineArena
          debate={debate}
          hostName={hostName}
          viewerSeat={user.id === debate.user_id ? 'host' : 'guest'}
          deepDiveUnlocked={deepDiveUnlocked}
          isFounding={isFounding}
        />
      )
    }

    // Same-device exhibition.
    return (
      <VersusArena
        debate={debate}
        hostName={hostName}
        deepDiveUnlocked={deepDiveUnlocked}
        isFounding={isFounding}
      />
    )
  }

  return (
    <DebateArena debate={debate} deepDiveUnlocked={deepDiveUnlocked} isFounding={isFounding} />
  )
}
