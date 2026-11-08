import Link from 'next/link'
import { redirect } from 'next/navigation'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'
import { getOrCreateTodayPrompt } from '@/lib/daily'
import DailyArena from '@/components/daily-arena'
import PageHeader from '@/components/page-header'
import { buttonClasses } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

type BoardRow = { user_id: string; username: string; score: number }

export default async function DailyPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const prompt = await getOrCreateTodayPrompt(supabaseAdmin())
  if (!prompt) {
    // Generation + fallback both failed (should never happen): degrade gracefully.
    return (
      <>
        <PageHeader eyebrow="THE DAILY" title={<>One prompt. One shot.</>} />
        <div className="bezel mt-8 px-6 py-14 text-center">
          <p className="font-athletic text-2xl font-black uppercase tracking-tight">
            Today&apos;s prompt is warming up
          </p>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-chalk-3">
            Check back in a minute. Nothing is broken on your end.
          </p>
          <Link
            href="/dashboard"
            className={buttonClasses('secondary', 'md', 'mt-6')}
          >
            Back to the locker room
          </Link>
        </div>
      </>
    )
  }

  const [{ data: myAttempt }, { data: boardRaw }, { count: takeCount }] = await Promise.all([
    supabase
      .from('daily_attempts')
      .select('score, side, breakdown')
      .eq('daily_prompt_id', prompt.id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('daily_attempts')
      .select('user_id, score, profiles!inner(username)')
      .eq('daily_prompt_id', prompt.id)
      .order('score', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(25),
    // A real count: the board is the top 25, so its length read "25" forever
    // once the Daily passed 25 players.
    supabase
      .from('daily_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('daily_prompt_id', prompt.id),
  ])
  const takes = takeCount ?? 0

  // Normalize the embedded profiles relation (object or array depending on
  // PostgREST inference) down to a flat username, same pattern as the dashboard.
  const board: BoardRow[] = (boardRaw ?? []).map((row) => {
    const p = (row as { profiles: unknown }).profiles
    const arr = Array.isArray(p) ? p : p ? [p] : []
    const username = (arr[0] as { username?: string })?.username ?? 'baller'
    return { user_id: (row as { user_id: string }).user_id, score: (row as { score: number }).score, username }
  })

  return (
    <>
      <PageHeader
        eyebrow="THE DAILY · ONE SHOT"
        title={<>One prompt. One shot.</>}
        stat={
          takes === 0 ? 'BE THE FIRST TAKE TODAY' : `${takes} ${takes === 1 ? 'TAKE' : 'TAKES'} IN TODAY`
        }
      />

        <DailyArena
          prompt={{
            id: prompt.id,
            format: prompt.format,
            topic: prompt.topic,
            stance_a: prompt.stance_a,
            stance_b: prompt.stance_b,
          }}
          myAttempt={myAttempt ?? null}
          board={board}
          myUserId={user.id}
        />
    </>
  )
}
