// Server-only settlement for RANKED online Human vs Human debates.
//
// One entry point, used by three finishers: the judge route (normal verdict),
// the round route (moderation walkover), and the abandon route (forfeit
// walkover). Centralizing it keeps the double-submit guard, the rematch decay,
// the founding boost, and the both-profile updates in one place so no path can
// award points twice or differently.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  h2hPointsDelta,
  applyFounding,
  type Verdict,
  type HumanSpeaker,
} from '@/lib/debate'
// Aliased because `awardBadges` is already taken here by the boolean option that
// decides WHETHER to award (a walkover must not mint score-derived badges).
import { awardBadges as grantBadges, type AwardedBadge } from '@/lib/badge-award'

export type SeatBadge = AwardedBadge

export type SettleResult = {
  hostDelta: number
  guestDelta: number
  hostBadges: SeatBadge[]
  guestBadges: SeatBadge[]
}

// Rolling 24h lookback for the rematch decay (founder call, 2026-08-10; was
// Monday 00:00 UTC of the current week). The decay is a cooldown, not a weekly
// budget: run it back with the same person inside a day and the repeat win pays
// less, but a day later it is full price again, so an ongoing rivalry is never
// permanently taxed. Deliberately NO LONGER aligned to the DB cap trigger's
// date_trunc('week', now()) — the cap window and the decay window are now
// different things on purpose.
export const REMATCH_WINDOW_HOURS = 24

export function rematchWindowStartISO(): string {
  return new Date(Date.now() - REMATCH_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
}

// This winner's completed ranked online wins against this same opponent inside
// the rematch window, excluding the debate being settled. Drives the 10% decay.
async function priorWinsInWindow(
  admin: SupabaseClient,
  winnerId: string,
  loserId: string,
  excludeDebateId: string
): Promise<number> {
  const since = rematchWindowStartISO()
  const [{ count: asHost }, { count: asGuest }] = await Promise.all([
    admin
      .from('debates')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', winnerId)
      .eq('opponent_user_id', loserId)
      .eq('status', 'complete')
      .eq('winner', 'user')
      .gte('created_at', since)
      .neq('id', excludeDebateId),
    admin
      .from('debates')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', loserId)
      .eq('opponent_user_id', winnerId)
      .eq('status', 'complete')
      .eq('winner', 'opponent')
      .gte('created_at', since)
      .neq('id', excludeDebateId),
  ])
  return (asHost ?? 0) + (asGuest ?? 0)
}

type ProfileRow = {
  id: string
  points: number
  wins: number
  losses: number
  current_streak: number
  best_streak: number
  h2h_wins: number
  h2h_losses: number
  is_founding: boolean
}

// Settles a ranked online H2H debate: writes the verdict (guarded — only the
// FIRST caller for a given debate wins the race, everyone else gets null back
// and must not re-award anything), then moves points, W/L, streaks, the H2H
// ledger, and (optionally) badges for BOTH seats.
//
// `awardBadges: false` is for walkovers (forfeit / moderation): stats still
// move — a win is a win — but a 100-0 walkover must not unlock Flawless.
export async function settleRankedH2H(
  admin: SupabaseClient,
  opts: {
    debateId: string
    hostId: string
    guestId: string
    verdict: Verdict
    // 'flagged' seat takes the heavier moderation penalty instead of -25.
    flaggedSeat?: HumanSpeaker
    awardBadges: boolean
    // Extra debate columns to write alongside the verdict (e.g. rounds for the
    // moderation path).
    extraDebateFields?: Record<string, unknown>
  }
): Promise<SettleResult | null> {
  const { debateId, hostId, guestId, verdict, flaggedSeat, awardBadges, extraDebateFields } = opts

  const winnerSeat: HumanSpeaker | null =
    verdict.winner === 'user' ? 'host' : verdict.winner === 'opponent' ? 'guest' : null

  // ── Compute deltas (pure reads, safe before the guarded write) ────
  let hostDelta = 0
  let guestDelta = 0
  const [{ data: hostProf }, { data: guestProf }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, points, wins, losses, current_streak, best_streak, h2h_wins, h2h_losses, is_founding')
      .eq('id', hostId)
      .single(),
    admin
      .from('profiles')
      .select('id, points, wins, losses, current_streak, best_streak, h2h_wins, h2h_losses, is_founding')
      .eq('id', guestId)
      .single(),
  ])

  if (winnerSeat) {
    const winnerId = winnerSeat === 'host' ? hostId : guestId
    const loserId = winnerSeat === 'host' ? guestId : hostId
    const winnerFounding = Boolean((winnerSeat === 'host' ? hostProf : guestProf)?.is_founding)
    const prior = await priorWinsInWindow(admin, winnerId, loserId, debateId)
    const winDelta = applyFounding(h2hPointsDelta('win', prior), winnerFounding)
    const lossOutcome = flaggedSeat && flaggedSeat !== winnerSeat ? 'flagged' : 'loss'
    const lossDelta = h2hPointsDelta(lossOutcome, 0)
    hostDelta = winnerSeat === 'host' ? winDelta : lossDelta
    guestDelta = winnerSeat === 'guest' ? winDelta : lossDelta
  }

  // ── Guarded verdict write: the double-submit / double-award gate ──
  const { data: written, error: writeError } = await admin
    .from('debates')
    .update({
      verdict,
      user_score: verdict.user_score,
      opponent_score: verdict.ai_score,
      winner: verdict.winner,
      points_earned: hostDelta,
      opponent_points_earned: guestDelta,
      status: 'complete',
      ...(extraDebateFields ?? {}),
    })
    .eq('id', debateId)
    .is('verdict', null)
    .select('id')
  if (writeError) throw writeError
  if (!written || written.length === 0) return null // lost the race

  // Tie: verdict recorded, nothing moves on either profile.
  if (!winnerSeat) {
    return { hostDelta: 0, guestDelta: 0, hostBadges: [], guestBadges: [] }
  }

  // ── Apply both profiles + optional badges ─────────────────────────
  const seats: { speaker: HumanSpeaker; prof: ProfileRow | null; delta: number; won: boolean; score: number }[] = [
    { speaker: 'host', prof: hostProf, delta: hostDelta, won: winnerSeat === 'host', score: verdict.user_score },
    { speaker: 'guest', prof: guestProf, delta: guestDelta, won: winnerSeat === 'guest', score: verdict.ai_score },
  ]

  const result: SettleResult = { hostDelta, guestDelta, hostBadges: [], guestBadges: [] }

  for (const seat of seats) {
    if (!seat.prof) continue
    const streak = seat.won ? seat.prof.current_streak + 1 : 0
    const after = {
      points: Math.max(0, seat.prof.points + seat.delta),
      wins: seat.prof.wins + (seat.won ? 1 : 0),
      losses: seat.prof.losses + (seat.won ? 0 : 1),
      current_streak: streak,
      best_streak: Math.max(seat.prof.best_streak, streak),
      h2h_wins: seat.prof.h2h_wins + (seat.won ? 1 : 0),
      h2h_losses: seat.prof.h2h_losses + (seat.won ? 0 : 1),
    }
    await admin.from('profiles').update(after).eq('id', seat.prof.id)

    if (!awardBadges) continue
    // `difficulty` is deliberately omitted rather than faked as 'starter'. The
    // only rule that reads it is certified_hooper ("beat the AI on Hall of
    // Famer"), which a human opponent can never satisfy, and BadgeStats treats a
    // missing stat as "do not evaluate" — so leaving it out expresses the intent
    // directly instead of passing a wrong value and filtering the result.
    const badges = await grantBadges(admin, seat.prof.id, {
      won: seat.won,
      userScore: seat.score,
      wins: after.wins,
      bestStreak: after.best_streak,
      points: after.points,
      decidedDebates: after.wins + after.losses,
      h2hWins: after.h2h_wins,
    })
    if (badges.length === 0) continue
    if (seat.speaker === 'host') result.hostBadges = badges
    else result.guestBadges = badges
  }

  return result
}
