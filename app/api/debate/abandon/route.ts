import { NextResponse } from 'next/server'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'
import { getRoomPresence, roomNameFromUrl } from '@/lib/daily-rooms'
import {
  ABANDON_GRACE_SECONDS,
  VOID_MIN_SUBMITTED,
  nextHumanTurn,
  type RoundEntry,
  type Verdict,
  type VersusConfig,
  type HumanSpeaker,
} from '@/lib/debate'
import { settleRankedH2H } from '@/lib/h2h-settle'

export const maxDuration = 30

// Disconnect handling for online ranked matches: void early, forfeit late.
//
// The STAYING player calls this when their opponent drops. Nothing is trusted
// client-side: the server checks Daily's presence API to confirm the opponent
// really is gone, stamps a grace claim in versus.abandon, and only finalizes
// on a second call once ABANDON_GRACE_SECONDS have elapsed AND the opponent is
// still absent. Fewer than VOID_MIN_SUBMITTED submitted rounds -> the match is
// VOIDED (status 'void': no points, both tickets refunded by the
// trigger's exclusion). Otherwise the leaver takes a forfeit loss and the
// stayer a walkover win (stats move, badges deliberately do not).
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
      .select('id, user_id, opponent_user_id, status, rounds, verdict, versus')
      .eq('id', debateId)
      .maybeSingle()
    const versus = (debate?.versus ?? {}) as Partial<VersusConfig>
    if (!debate || !debate.opponent_user_id || !versus.room_url) {
      return NextResponse.json({ error: 'match not found' }, { status: 404 })
    }
    if (user.id !== debate.user_id && user.id !== debate.opponent_user_id) {
      return NextResponse.json({ error: 'match not found' }, { status: 404 })
    }
    if (debate.verdict || debate.status === 'complete' || debate.status === 'void' || debate.status === 'error') {
      return NextResponse.json({ error: 'match already finished' }, { status: 409 })
    }

    const callerSeat: HumanSpeaker = user.id === debate.user_id ? 'host' : 'guest'
    const otherSeat: HumanSpeaker = callerSeat === 'host' ? 'guest' : 'host'
    const otherId = callerSeat === 'host' ? debate.opponent_user_id : debate.user_id

    // ── Verify the opponent is actually gone (Daily presence, not the claim) ──
    const presence = await getRoomPresence(roomNameFromUrl(versus.room_url))
    if (presence.userIds.includes(otherId)) {
      // They're in the room: clear any stale claim and report recovery.
      if (versus.abandon) {
        await admin
          .from('debates')
          .update({ versus: { ...versus, abandon: null } })
          .eq('id', debateId)
      }
      return NextResponse.json({ status: 'present' })
    }

    const now = Date.now()
    const claim = versus.abandon
    if (!claim || claim.absent !== otherSeat) {
      // First observation of the absence: start the grace clock.
      await admin
        .from('debates')
        .update({
          versus: { ...versus, abandon: { absent: otherSeat, since: new Date(now).toISOString() } },
        })
        .eq('id', debateId)
      return NextResponse.json({ status: 'grace', retryAfter: ABANDON_GRACE_SECONDS })
    }

    const elapsed = (now - new Date(claim.since).getTime()) / 1000
    if (elapsed < ABANDON_GRACE_SECONDS) {
      return NextResponse.json({
        status: 'grace',
        retryAfter: Math.ceil(ABANDON_GRACE_SECONDS - elapsed),
      })
    }

    // ── Grace expired, opponent still gone: finalize ──────────────
    const rounds = (debate.rounds ?? []) as RoundEntry[]
    const first: HumanSpeaker = versus.first === 'guest' ? 'guest' : 'host'

    // UPPER bound, and it matters as much as the lower one. All six turns in
    // means this match was fully argued and is only waiting on the judge. There
    // was no bound here, so a disconnect during wrapup fell straight through to
    // the walkover below and overwrote a real debate with a synthetic 100/0,
    // settling ranked points, W/L and the h2h ledger off a forfeit that never
    // happened. Nobody leaving after the last word can change the result.
    if (nextHumanTurn(rounds, first) === null) {
      return NextResponse.json({ status: 'complete' }, { status: 409 })
    }

    if (rounds.length < VOID_MIN_SUBMITTED) {
      // Too early to call it a real match: void it, refund both cap slots.
      // Guard on verdict-null + non-void so a racing judge/abandon call can't
      // double-finalize.
      const { data: voided } = await admin
        .from('debates')
        .update({ status: 'void' })
        .eq('id', debateId)
        .is('verdict', null)
        .neq('status', 'void')
        .select('id')
      if (!voided || voided.length === 0) {
        return NextResponse.json({ error: 'match already finished' }, { status: 409 })
      }
      return NextResponse.json({ status: 'void' })
    }

    // Walkover: the stayer wins, the leaver takes a normal loss.
    const stayerWon = callerSeat === 'host'
    const { data: hostProf } = await admin
      .from('profiles')
      .select('username')
      .eq('id', debate.user_id)
      .single()
    const hostName = hostProf?.username ?? 'The host'
    const guestName = versus.guest_name ?? 'The challenger'
    const leaverName = otherSeat === 'host' ? hostName : guestName
    const stayerName = callerSeat === 'host' ? hostName : guestName

    const verdict: Verdict = {
      user_score: stayerWon ? 100 : 0,
      ai_score: stayerWon ? 0 : 100,
      winner: stayerWon ? 'user' : 'opponent',
      note: `Walkover. ${leaverName} left the arena and did not return inside the grace window, so ${stayerName} takes the win by forfeit.`,
      receipts: [],
    }

    const settled = await settleRankedH2H(admin, {
      debateId,
      hostId: debate.user_id,
      guestId: debate.opponent_user_id,
      verdict,
      awardBadges: false, // a walkover must not unlock Flawless etc.
    })
    if (!settled) {
      return NextResponse.json({ error: 'match already finished' }, { status: 409 })
    }

    return NextResponse.json({
      status: 'forfeit',
      verdict,
      pointsHost: settled.hostDelta,
      pointsGuest: settled.guestDelta,
    })
  } catch (err) {
    console.error('abandon route error', err)
    return NextResponse.json({ error: 'could not resolve the disconnect' }, { status: 500 })
  }
}
