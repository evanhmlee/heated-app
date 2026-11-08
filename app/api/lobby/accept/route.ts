import { NextResponse } from 'next/server'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'
import { generateTopicWithFallback } from '@/lib/topic-gen'
import { createRoom } from '@/lib/daily-rooms'
import { type Difficulty, type HumanSpeaker, type VersusConfig } from '@/lib/debate'
import { isOutOfTickets } from '@/lib/tickets'

export const maxDuration = 30

// The host accepts one challenger: this is where an online match actually
// forms. Generates the topic (random lobbies), flips the coins, inserts the
// ranked debate (the DB trigger charges BOTH players a ticket on this
// insert), creates the private Daily room, and closes out the request queue.
// Everything after auth runs with the service role — opponent_user_id is not
// client-insertable by design.
export async function POST(request: Request) {
  try {
    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const lobbyId = typeof body?.lobbyId === 'string' ? body.lobbyId : ''
    const requesterId = typeof body?.requesterId === 'string' ? body.requesterId : ''
    if (!lobbyId || !requesterId) {
      return NextResponse.json({ error: 'lobbyId and requesterId required' }, { status: 400 })
    }

    const admin = supabaseAdmin()
    const { data: lobby } = await admin
      .from('lobbies')
      .select('id, host_id, status, topic_source, topic_text, host_side, guest_side, difficulty, turn_seconds')
      .eq('id', lobbyId)
      .maybeSingle()
    if (!lobby || lobby.host_id !== user.id) {
      return NextResponse.json({ error: 'lobby not found' }, { status: 404 })
    }
    if (lobby.status !== 'open') {
      return NextResponse.json({ error: 'lobby is no longer open' }, { status: 409 })
    }

    const { data: req } = await admin
      .from('lobby_requests')
      .select('status')
      .eq('lobby_id', lobbyId)
      .eq('requester_id', requesterId)
      .maybeSingle()
    if (!req || req.status !== 'pending') {
      return NextResponse.json({ error: 'no pending request from that player' }, { status: 409 })
    }

    const { data: guestProf } = await admin
      .from('profiles')
      .select('username')
      .eq('id', requesterId)
      .single()
    const guestName = guestProf?.username ?? 'The Challenger'

    // ── The matchup ────────────────────────────────────────────────
    // Custom: the lobby carries topic + sides (host picked their own side up
    // front, the challenger saw it before requesting). Random: generated NOW,
    // revealed to both players at tip-off, sides on a fair coin.
    let topicText: string
    let hostSide: string
    let guestSide: string
    if (lobby.topic_source === 'custom') {
      topicText = lobby.topic_text!
      hostSide = lobby.host_side!
      guestSide = lobby.guest_side!
    } else {
      const topic = await generateTopicWithFallback((lobby.difficulty ?? 'starter') as Difficulty)
      topicText = topic.topic
      const hostGetsEasy = Math.random() < 0.5
      hostSide = hostGetsEasy ? topic.easySide : topic.hardSide
      guestSide = hostGetsEasy ? topic.hardSide : topic.easySide
    }
    const first: HumanSpeaker = Math.random() < 0.5 ? 'host' : 'guest'

    const versus: VersusConfig = {
      guest_name: guestName,
      guest_side: guestSide,
      turn_seconds: lobby.turn_seconds,
      first,
      online: true,
    }

    // ── Insert the ranked debate (cap trigger checks both seats) ──
    const { data: debate, error: insertError } = await admin
      .from('debates')
      .insert({
        user_id: lobby.host_id,
        opponent_user_id: requesterId,
        topic_text: topicText,
        user_side: hostSide,
        mode: 'speech',
        difficulty: lobby.difficulty,
        is_random: lobby.topic_source === 'random',
        opponent: 'human',
        status: 'created',
        versus,
      })
      .select('id')
      .single()

    if (insertError) {
      if (isOutOfTickets(insertError.message)) {
        const challengerOver = insertError.message.includes('challenger')
        if (challengerOver) {
          // The challenger spent their last ticket since requesting: clear the
          // stale request so the host isn't stuck re-accepting a dead one.
          await admin
            .from('lobby_requests')
            .update({ status: 'declined' })
            .eq('lobby_id', lobbyId)
            .eq('requester_id', requesterId)
        }
        return NextResponse.json(
          {
            error: challengerOver
              ? 'that player is out of debates'
              : 'you are out of debates',
            seat: challengerOver ? 'challenger' : 'host',
            capReached: true,
          },
          { status: 403 }
        )
      }
      console.error('online debate insert failed', insertError)
      return NextResponse.json({ error: 'could not start the match' }, { status: 500 })
    }

    // ── Private Daily room. If this fails, unwind the debate row so the
    // cap slots are not burned on a match that can never happen. ─────
    let roomUrl: string
    try {
      const room = await createRoom(debate.id)
      roomUrl = room.url
    } catch (err) {
      console.error('daily room creation failed', err)
      await admin.from('debates').delete().eq('id', debate.id)
      return NextResponse.json(
        { error: 'could not create the video room, try again' },
        { status: 502 }
      )
    }
    await admin
      .from('debates')
      .update({ versus: { ...versus, room_url: roomUrl } })
      .eq('id', debate.id)

    // ── Close out the queue: accept one, decline the rest, match the lobby ──
    await admin
      .from('lobby_requests')
      .update({ status: 'accepted' })
      .eq('lobby_id', lobbyId)
      .eq('requester_id', requesterId)
    await admin
      .from('lobby_requests')
      .update({ status: 'declined' })
      .eq('lobby_id', lobbyId)
      .eq('status', 'pending')
    await admin
      .from('lobbies')
      .update({ status: 'matched', accepted_user_id: requesterId, debate_id: debate.id })
      .eq('id', lobbyId)

    return NextResponse.json({ debateId: debate.id })
  } catch (err) {
    console.error('lobby accept error', err)
    return NextResponse.json({ error: 'could not accept the challenger' }, { status: 500 })
  }
}
