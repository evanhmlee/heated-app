import { NextResponse } from 'next/server'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'
import { LOBBY_TTL_MINUTES } from '@/lib/debate'
import { canDebate, walletFrom } from '@/lib/tickets'

export const maxDuration = 15

// Requests to join a lobby, by code (private share) or lobby id (the live
// board). Service role does the lookup + insert: lobby_requests has NO client
// INSERT grant, so unlisted codes stay unenumerable (same pattern as
// pitchcoach team joins), and a generic 404 never confirms whether a guessed
// code exists.
export async function POST(request: Request) {
  try {
    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : ''
    const lobbyId = typeof body?.lobbyId === 'string' ? body.lobbyId : ''
    if (!code && !lobbyId) {
      return NextResponse.json({ error: 'code or lobbyId required' }, { status: 400 })
    }

    const admin = supabaseAdmin()
    let query = admin
      .from('lobbies')
      .select('id, host_id, status, created_at')
    query = code ? query.eq('code', code) : query.eq('id', lobbyId)
    const { data: lobby } = await query.maybeSingle()

    const freshCutoff = Date.now() - LOBBY_TTL_MINUTES * 60 * 1000
    if (
      !lobby ||
      lobby.status !== 'open' ||
      new Date(lobby.created_at).getTime() < freshCutoff
    ) {
      // Bad code, cancelled, matched, or expired — one indistinguishable 404.
      return NextResponse.json({ error: 'no open debate found' }, { status: 404 })
    }
    if (lobby.host_id === user.id) {
      return NextResponse.json({ error: 'that is your own lobby' }, { status: 400 })
    }

    // Friendly pre-check on the challenger's tickets. The DB trigger at accept
    // time is the real enforcement — this just saves a host from accepting
    // someone who can't actually play.
    const { data: prof } = await admin
      .from('profiles')
      .select('tickets, purchased_tickets, tickets_updated_at, is_pro')
      .eq('id', user.id)
      .single()
    if (!prof || !canDebate(walletFrom(prof))) {
      return NextResponse.json(
        { error: 'out of tickets', capReached: true },
        { status: 403 }
      )
    }

    const { data: existing } = await admin
      .from('lobby_requests')
      .select('status')
      .eq('lobby_id', lobby.id)
      .eq('requester_id', user.id)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ lobbyId: lobby.id, status: existing.status })
    }

    const { error: insertError } = await admin.from('lobby_requests').insert({
      lobby_id: lobby.id,
      requester_id: user.id,
    })
    if (insertError) {
      console.error('lobby request insert failed', insertError)
      return NextResponse.json({ error: 'could not request to join' }, { status: 500 })
    }

    return NextResponse.json({ lobbyId: lobby.id, status: 'pending' })
  } catch (err) {
    console.error('lobby join error', err)
    return NextResponse.json({ error: 'could not request to join' }, { status: 500 })
  }
}
