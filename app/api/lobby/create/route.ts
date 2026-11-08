import { NextResponse } from 'next/server'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'
import { DIFFICULTIES, TURN_LENGTH_OPTIONS, type Difficulty } from '@/lib/debate'
import { canDebate, walletFrom } from '@/lib/tickets'

export const maxDuration = 15

// No ambiguous characters (0/O, 1/I/L) — same Crockford-ish alphabet as
// pitchcoach team invite codes. 8 chars of this is ~10^12 combinations:
// unenumerable, especially with joins funneled through the service-role route.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
function generateCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

// Creates an online-H2H lobby. The insert runs as the caller (RLS pins
// host_id, the partial unique index enforces one open lobby per host); the
// route exists because the invite code must be generated and collision-retried
// server-side.
export async function POST(request: Request) {
  try {
    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const topicSource = body?.topicSource === 'custom' ? 'custom' : 'random'
    const difficulty: Difficulty = DIFFICULTIES.includes(body?.difficulty)
      ? body.difficulty
      : 'starter'
    const turnSeconds = TURN_LENGTH_OPTIONS.includes(body?.turnSeconds)
      ? (body.turnSeconds as number)
      : 120
    const isListed = body?.isListed !== false

    let topicText: string | null = null
    let hostSide: string | null = null
    let guestSide: string | null = null
    if (topicSource === 'custom') {
      topicText = String(body?.topicText ?? '').trim().slice(0, 200) || null
      hostSide = String(body?.hostSide ?? '').trim().slice(0, 120) || null
      guestSide = String(body?.guestSide ?? '').trim().slice(0, 120) || null
      if (!topicText || !hostSide || !guestSide) {
        return NextResponse.json(
          { error: 'custom lobbies need a topic and both sides' },
          { status: 400 }
        )
      }
    }

    // Friendly ticket pre-check: a host with nothing to spend shouldn't open a
    // lobby (the DB trigger at accept time is the real enforcement — this just
    // avoids stranding a challenger in a queue the host can never accept from).
    // Read-only, so it never moves the balance; walletFrom accrues in memory.
    const admin = supabaseAdmin()
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

    // Code collisions are near-impossible but cheap to retry.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await supabase
        .from('lobbies')
        .insert({
          host_id: user.id,
          code: generateCode(),
          is_listed: isListed,
          topic_source: topicSource,
          topic_text: topicText,
          host_side: hostSide,
          guest_side: guestSide,
          difficulty,
          turn_seconds: turnSeconds,
        })
        .select('id, code')
        .single()

      if (!error) return NextResponse.json({ id: data.id, code: data.code })

      if (error.message.includes('lobbies_one_open_per_host')) {
        // Already hosting an open lobby: hand its id back so the client can
        // just navigate there instead of erroring.
        const { data: existing } = await supabase
          .from('lobbies')
          .select('id')
          .eq('host_id', user.id)
          .eq('status', 'open')
          .maybeSingle()
        return NextResponse.json(
          { error: 'you already have an open lobby', existingId: existing?.id ?? null },
          { status: 409 }
        )
      }
      if (!error.message.includes('lobbies_code_key')) {
        console.error('lobby create failed', error)
        return NextResponse.json({ error: 'could not create the lobby' }, { status: 500 })
      }
      // else: code collision — loop and retry with a fresh code
    }
    return NextResponse.json({ error: 'could not create the lobby' }, { status: 500 })
  } catch (err) {
    console.error('lobby create error', err)
    return NextResponse.json({ error: 'could not create the lobby' }, { status: 500 })
  }
}
