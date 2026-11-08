import { NextResponse } from 'next/server'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'
import { createMeetingToken, roomNameFromUrl } from '@/lib/daily-rooms'
import type { VersusConfig } from '@/lib/debate'

export const maxDuration = 15

// Mints a per-user Daily meeting token for an online match's private room.
// Only the two seated players can get one — the room URL alone admits nobody.
export async function POST(request: Request) {
  try {
    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const debateId = typeof body?.debateId === 'string' ? body.debateId : ''
    if (!debateId) return NextResponse.json({ error: 'debateId required' }, { status: 400 })

    const admin = supabaseAdmin()
    const { data: debate } = await admin
      .from('debates')
      .select('id, user_id, opponent_user_id, status, versus')
      .eq('id', debateId)
      .maybeSingle()
    const versus = (debate?.versus ?? {}) as Partial<VersusConfig>
    if (!debate || debate.opponent_user_id === null || !versus.room_url) {
      return NextResponse.json({ error: 'match not found' }, { status: 404 })
    }
    if (user.id !== debate.user_id && user.id !== debate.opponent_user_id) {
      return NextResponse.json({ error: 'match not found' }, { status: 404 })
    }
    if (debate.status === 'complete' || debate.status === 'void' || debate.status === 'error') {
      return NextResponse.json({ error: 'match already finished' }, { status: 409 })
    }

    const { data: prof } = await admin
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single()

    const token = await createMeetingToken(
      roomNameFromUrl(versus.room_url),
      user.id,
      prof?.username ?? 'baller'
    )
    return NextResponse.json({ token, roomUrl: versus.room_url })
  } catch (err) {
    console.error('lobby token error', err)
    return NextResponse.json({ error: 'could not join the room' }, { status: 500 })
  }
}
