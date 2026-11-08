import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase-server'
import PageHeader from '@/components/page-header'
import LiveBoard, { type BoardLobby } from '@/components/live-board'
import { lobbyFreshCutoffISO } from '@/lib/debate'

export const dynamic = 'force-dynamic'

// THE LIVE BOARD: open online lobbies anyone can request to join. Listed
// lobbies only (unlisted ones are joined by code — the input on this page
// handles that, prefilled from ?code= share links).
export default async function LivePage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const freshCutoff = lobbyFreshCutoffISO()

  const [{ data: lobbies }, { data: mine }, { data: myRequests }] = await Promise.all([
    supabase
      .from('lobbies')
      .select(
        'id, host_id, topic_source, topic_text, host_side, guest_side, difficulty, turn_seconds, created_at, host:profiles!lobbies_host_id_fkey(username, points, wins, losses)'
      )
      .eq('status', 'open')
      .eq('is_listed', true)
      .gte('created_at', freshCutoff)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('lobbies')
      .select('id, status, created_at')
      .eq('host_id', user.id)
      .eq('status', 'open')
      .maybeSingle(),
    supabase
      .from('lobby_requests')
      .select('lobby_id, status')
      .eq('requester_id', user.id)
      .eq('status', 'pending'),
  ])

  // The embed comes back loosely typed (object or array); normalize.
  const board: BoardLobby[] = (lobbies ?? []).map((l) => {
    const h = Array.isArray(l.host) ? l.host[0] : l.host
    return {
      id: l.id,
      hostId: l.host_id,
      topicSource: l.topic_source as 'random' | 'custom',
      topicText: l.topic_text,
      hostSide: l.host_side,
      guestSide: l.guest_side,
      difficulty: l.difficulty,
      turnSeconds: l.turn_seconds,
      createdAt: l.created_at,
      host: {
        username: h?.username ?? 'baller',
        points: h?.points ?? 0,
        wins: h?.wins ?? 0,
        losses: h?.losses ?? 0,
      },
    }
  })

  return (
    <>
      <PageHeader
        eyebrow="LIVE · RANKED"
        title={<>Somebody&apos;s wrong out there.</>}
        stat={
          board.length === 0
            ? 'NOBODY UP RIGHT NOW'
            : `${board.length} ${board.length === 1 ? 'LOBBY' : 'LOBBIES'} OPEN`
        }
      />

        <Suspense fallback={null}>
          <LiveBoard
            lobbies={board}
            myUserId={user.id}
            myOpenLobbyId={mine?.id ?? null}
            myPendingLobbyIds={(myRequests ?? []).map((r) => r.lobby_id)}
          />
        </Suspense>
    </>
  )
}
