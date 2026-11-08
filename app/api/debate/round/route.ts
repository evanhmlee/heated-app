import { NextResponse } from 'next/server'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'
import { classify } from '@/lib/moderation'
import {
  nextTurn,
  nextHumanTurn,
  pointsDelta,
  profanityAction,
  PROFANITY_STRIKE_PENALTY,
  MAX_ROUND_CHARS,
  REDACTED_TURN_TEXT,
  type RoundEntry,
  type Verdict,
  type Difficulty,
  type VersusConfig,
  type HumanSpeaker,
} from '@/lib/debate'
import { settleRankedH2H } from '@/lib/h2h-settle'

export const maxDuration = 30

// Count how many times a given speaker has already been flagged in this debate
// (their prior redacted turns) — drives the graduated profanity ladder.
function priorRedactions(rounds: RoundEntry[], speaker: RoundEntry['speaker']): number {
  return rounds.filter((r) => r.speaker === speaker && r.text === REDACTED_TURN_TEXT).length
}

// Loss-verdict copy, severity-aware: slurs are called out as hate speech (zero
// tolerance), a 3rd profanity as repeated language after warnings.
function lossNote(severity: 'slur' | 'profanity', arena: 'debate' | 'match'): string {
  if (severity === 'slur') {
    return `This ${arena} was ended for hate speech. Slurs are an automatic loss with no warnings. That language has no place here.`
  }
  return `This ${arena} was ended after repeated inappropriate language despite warnings. That is an automatic loss and costs more than a normal defeat.`
}

// Saves a user's argument for the current round — the authoritative, server-side
// entry point (moderation must not be client-bypassable). Clean text is appended
// and the client then calls /opponent. Inappropriate language is an automatic
// loss with a heavier point deduction, finalized here before any Claude call.
export async function POST(request: Request) {
  try {
    const { debateId, text } = await request.json()
    if (!debateId || typeof text !== 'string') {
      return NextResponse.json({ error: 'debateId and text required' }, { status: 400 })
    }

    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { data: debate, error } = await supabase
      .from('debates')
      .select('id, user_id, opponent_user_id, rounds, status, difficulty, is_random, verdict, opponent, versus')
      .eq('id', debateId)
      .single()
    if (error || !debate) {
      return NextResponse.json({ error: 'debate not found' }, { status: 404 })
    }
    if (debate.status === 'complete' || debate.status === 'error' || debate.verdict) {
      return NextResponse.json({ error: 'debate already finished' }, { status: 409 })
    }

    const rounds = (debate.rounds ?? []) as RoundEntry[]

    const clean = text.trim().slice(0, MAX_ROUND_CHARS)
    if (!clean) {
      return NextResponse.json({ error: 'empty argument' }, { status: 400 })
    }

    // ── Human vs Human: server-computed turn order ────────────────
    // The speaker isn't client-supplied: the server derives it from the stored
    // rounds + the setup coin flip, and the client submits turns in order.
    if (debate.opponent === 'human') {
      const versus = (debate.versus ?? {}) as Partial<VersusConfig>
      const first = versus.first === 'guest' ? 'guest' : 'host'
      const turn = nextHumanTurn(rounds, first)
      if (!turn) {
        return NextResponse.json({ error: 'debate already has all six turns' }, { status: 409 })
      }

      // Online ranked (opponent_user_id is service-role-set, unforgeable):
      // the caller must BE the account whose turn it is — the host submits
      // host turns, the challenger submits guest turns, each from their own
      // device. Same-device exhibitions keep the old model (the host's phone
      // submits every turn for both named speakers).
      const isRanked = Boolean(debate.opponent_user_id)
      if (isRanked) {
        const expected = turn.speaker === 'host' ? debate.user_id : debate.opponent_user_id
        if (user.id !== expected) {
          return NextResponse.json({ error: 'not your turn' }, { status: 409 })
        }
      }

      const severity = classify(clean)

      // ── Same-device exhibition: no points ride on it, so any flagged
      // language is just bleeped and the debate keeps going (can't fairly
      // penalize the un-accounted guest). ─────────────────────────────
      if (!isRanked) {
        const redacted = severity !== 'clean'
        const updated: RoundEntry[] = [
          ...rounds,
          { round: turn.round, speaker: turn.speaker, text: redacted ? REDACTED_TURN_TEXT : clean },
        ]
        const { error: saveError } = await supabase
          .from('debates')
          .update({ rounds: updated, status: 'arguing', updated_at: new Date().toISOString() })
          .eq('id', debateId)
        if (saveError) {
          return NextResponse.json({ error: 'failed to save round' }, { status: 500 })
        }
        return NextResponse.json({ flagged: false, redacted, rounds: updated })
      }

      // ── Online ranked: graduated ladder. Slurs are an instant loss; a
      // profanity offense is warn -> deduct -> loss by this speaker's prior
      // flag count. Writes go through the service role (the challenger has no
      // RLS UPDATE on the host's row — the turn check above is the auth). ──
      const admin = supabaseAdmin()
      const flaggedSeat: HumanSpeaker = turn.speaker
      const offendingId = flaggedSeat === 'host' ? debate.user_id : debate.opponent_user_id!

      if (severity !== 'clean') {
        const action =
          severity === 'slur' ? 'loss' : profanityAction(priorRedactions(rounds, flaggedSeat))
        const redactedRounds: RoundEntry[] = [
          ...rounds,
          { round: turn.round, speaker: flaggedSeat, text: REDACTED_TURN_TEXT },
        ]

        if (action === 'loss') {
          const winnerSeat: HumanSpeaker = flaggedSeat === 'host' ? 'guest' : 'host'
          const verdict: Verdict = {
            user_score: winnerSeat === 'host' ? 100 : 0,
            ai_score: winnerSeat === 'guest' ? 100 : 0,
            winner: winnerSeat === 'host' ? 'user' : 'opponent',
            note: lossNote(severity, 'match'),
            receipts: [],
          }
          const settled = await settleRankedH2H(admin, {
            debateId,
            hostId: debate.user_id,
            guestId: debate.opponent_user_id!,
            verdict,
            flaggedSeat,
            awardBadges: false,
            extraDebateFields: { rounds: redactedRounds },
          })
          if (!settled) {
            return NextResponse.json({ error: 'debate already finished' }, { status: 409 })
          }
          return NextResponse.json({
            flagged: true,
            moderation: { action, severity },
            verdict,
            rounds: redactedRounds,
            pointsHost: settled.hostDelta,
            pointsGuest: settled.guestDelta,
          })
        }

        // warn or deduct: redact this turn and keep playing. A deduct takes
        // points off the offender's profile immediately (independent of the
        // final verdict); a warn's only cost is the forfeited turn.
        const { error: saveError } = await admin
          .from('debates')
          .update({ rounds: redactedRounds, status: 'arguing', updated_at: new Date().toISOString() })
          .eq('id', debateId)
        if (saveError) {
          return NextResponse.json({ error: 'failed to save round' }, { status: 500 })
        }
        const penalty = action === 'deduct' ? PROFANITY_STRIKE_PENALTY : 0
        if (penalty > 0) {
          const { data: prof } = await admin
            .from('profiles')
            .select('points')
            .eq('id', offendingId)
            .single()
          if (prof) {
            await admin
              .from('profiles')
              .update({ points: Math.max(0, prof.points - penalty) })
              .eq('id', offendingId)
          }
        }
        return NextResponse.json({
          flagged: false,
          moderation: { action, severity, penalty, offense: priorRedactions(rounds, flaggedSeat) + 1 },
          rounds: redactedRounds,
        })
      }

      // Clean ranked turn.
      const updated: RoundEntry[] = [
        ...rounds,
        { round: turn.round, speaker: flaggedSeat, text: clean },
      ]
      const { error: saveError } = await admin
        .from('debates')
        .update({ rounds: updated, status: 'arguing', updated_at: new Date().toISOString() })
        .eq('id', debateId)
      if (saveError) {
        return NextResponse.json({ error: 'failed to save round' }, { status: 500 })
      }
      return NextResponse.json({ flagged: false, rounds: updated })
    }

    const turn = nextTurn(rounds)
    if (!turn || turn.speaker !== 'user') {
      return NextResponse.json({ error: 'not your turn' }, { status: 409 })
    }

    const difficulty = (debate.difficulty ?? 'starter') as Difficulty
    const isRandom = Boolean(debate.is_random)

    // ── Moderation: graduated ladder (slur -> instant loss; profanity ->
    // warn / deduct / loss by this user's prior flag count). ──────────
    const severity = classify(clean)
    if (severity !== 'clean') {
      const admin = supabaseAdmin()
      const action =
        severity === 'slur' ? 'loss' : profanityAction(priorRedactions(rounds, 'user'))
      const redactedRounds: RoundEntry[] = [
        ...rounds,
        { round: turn.round, speaker: 'user', text: REDACTED_TURN_TEXT },
      ]

      if (action === 'loss') {
        const penalty = pointsDelta('flagged', difficulty, isRandom) // negative
        const verdict: Verdict = {
          user_score: 0,
          ai_score: 100,
          winner: 'opponent',
          note: lossNote(severity, 'debate'),
          receipts: [],
        }
        await admin
          .from('debates')
          .update({
            rounds: redactedRounds,
            verdict,
            user_score: 0,
            opponent_score: 100,
            winner: 'opponent',
            points_earned: penalty,
            status: 'complete',
          })
          .eq('id', debateId)
          .is('verdict', null)

        const { data: profile } = await admin
          .from('profiles')
          .select('points, losses')
          .eq('id', debate.user_id)
          .single()
        if (profile) {
          await admin
            .from('profiles')
            .update({
              points: Math.max(0, profile.points + penalty),
              losses: profile.losses + 1,
              current_streak: 0,
            })
            .eq('id', debate.user_id)
        }

        return NextResponse.json({
          flagged: true,
          moderation: { action, severity },
          verdict,
          pointsEarned: penalty,
        })
      }

      // warn or deduct: redact this turn and keep playing (the client then
      // calls /opponent, which answers a dead turn). A deduct takes points off
      // immediately; a warn's only cost is the forfeited turn.
      const { error: saveError } = await admin
        .from('debates')
        .update({ rounds: redactedRounds, status: 'arguing', updated_at: new Date().toISOString() })
        .eq('id', debateId)
      if (saveError) {
        return NextResponse.json({ error: 'failed to save round' }, { status: 500 })
      }
      const penalty = action === 'deduct' ? PROFANITY_STRIKE_PENALTY : 0
      if (penalty > 0) {
        const { data: profile } = await admin
          .from('profiles')
          .select('points')
          .eq('id', debate.user_id)
          .single()
        if (profile) {
          await admin
            .from('profiles')
            .update({ points: Math.max(0, profile.points - penalty) })
            .eq('id', debate.user_id)
        }
      }
      return NextResponse.json({
        flagged: false,
        moderation: { action, severity, penalty, offense: priorRedactions(rounds, 'user') + 1 },
        rounds: redactedRounds,
      })
    }

    // ── Clean: append the round (RLS scopes the update to the owner) ─
    const updated: RoundEntry[] = [...rounds, { round: turn.round, speaker: 'user', text: clean }]
    const { error: saveError } = await supabase
      .from('debates')
      .update({ rounds: updated, status: 'arguing', updated_at: new Date().toISOString() })
      .eq('id', debateId)
    if (saveError) {
      return NextResponse.json({ error: 'failed to save round' }, { status: 500 })
    }

    return NextResponse.json({ flagged: false, rounds: updated })
  } catch (err) {
    console.error('round route error', err)
    return NextResponse.json({ error: 'failed to submit round' }, { status: 500 })
  }
}
