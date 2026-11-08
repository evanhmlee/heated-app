import { notFound, redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase-server'
import LobbyRoom from '@/components/lobby-room'

export const dynamic = 'force-dynamic'

// One page, two roles: the host manages the request queue and shares the
// code; a challenger watches their request until the host accepts. RLS
// scopes visibility (listed lobbies, the host, requesters, the accepted
// challenger); everyone else 404s.
export default async function LobbyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: lobby } = await supabase
    .from('lobbies')
    .select(
      'id, host_id, code, is_listed, topic_source, topic_text, host_side, guest_side, difficulty, turn_seconds, status, accepted_user_id, debate_id, created_at, host:profiles!lobbies_host_id_fkey(username, points, wins, losses)'
    )
    .eq('id', id)
    .maybeSingle()
  if (!lobby) notFound()

  const isHost = lobby.host_id === user.id

  // Already matched and this viewer is seated: straight to the arena.
  if (
    lobby.status === 'matched' &&
    lobby.debate_id &&
    (isHost || lobby.accepted_user_id === user.id)
  ) {
    redirect(`/dashboard/debate/${lobby.debate_id}`)
  }

  const h = Array.isArray(lobby.host) ? lobby.host[0] : lobby.host

  return (
    <LobbyRoom
      lobby={{
        id: lobby.id,
        hostId: lobby.host_id,
        code: lobby.code,
        isListed: lobby.is_listed,
        topicSource: lobby.topic_source as 'random' | 'custom',
        topicText: lobby.topic_text,
        hostSide: lobby.host_side,
        guestSide: lobby.guest_side,
        difficulty: lobby.difficulty,
        turnSeconds: lobby.turn_seconds,
        status: lobby.status,
        acceptedUserId: lobby.accepted_user_id,
        debateId: lobby.debate_id,
        createdAt: lobby.created_at,
      }}
      host={{
        username: h?.username ?? 'baller',
        points: h?.points ?? 0,
        wins: h?.wins ?? 0,
        losses: h?.losses ?? 0,
      }}
      viewerId={user.id}
    />
  )
}
