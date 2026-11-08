import { NextResponse } from 'next/server'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'
import {
  ROUND_ORDER,
  pointsDelta,
  applyFounding,
  nextHumanTurn,
  type RoundEntry,
  type Difficulty,
  type HumanSpeaker,
  type Verdict,
  type VersusConfig,
} from '@/lib/debate'
import { awardBadges, type AwardedBadge } from '@/lib/badge-award'
import {
  buildTranscript,
  PRODUCTION_VARIANT,
  type JudgeInput,
} from '@/lib/judge-prompt'
import { judgeDebate } from '@/lib/judge-run'
import { buildGroundingBlock } from '@/lib/nba-grounding'
import { settleRankedH2H } from '@/lib/h2h-settle'
import { isDeepDiveUnlocked, saveDeepDive, stripDeepDive, withDeepDive } from '@/lib/deep-dive'

export const maxDuration = 60

// Judges a finished debate: Claude at temperature 0 (score consistency,
// non-negotiable, same rule as pitchcoach), verdict + profile stats written
// with the service role so clients can never fabricate a win.
export async function POST(request: Request) {
  try {
    const { debateId } = await request.json()
    if (!debateId) {
      return NextResponse.json({ error: 'debateId required' }, { status: 400 })
    }

    // Ownership check through RLS with the caller's cookie client.
    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // The Deep Dive's prose is a Pro perk. It is never written into the debate
    // row (both seats can read that); it lives in debate_deep_dives, read here
    // with the service role for an effective-Pro caller only (lib/deep-dive.ts).
    const { data: caller } = await supabase
      .from('profiles')
      .select('is_pro, purchased_tickets')
      .eq('id', user.id)
      .single()
    const deepDiveUnlocked = isDeepDiveUnlocked(caller)
    const forCaller = (v: Verdict): Verdict => (deepDiveUnlocked ? v : stripDeepDive(v))

    const { data: debate, error } = await supabase
      .from('debates')
      .select('id, user_id, opponent_user_id, topic_text, user_side, rounds, status, verdict, difficulty, is_random, opponent, versus')
      .eq('id', debateId)
      .single()
    if (error || !debate) {
      return NextResponse.json({ error: 'debate not found' }, { status: 404 })
    }
    if (debate.verdict) {
      // Already judged: idempotent, hand back the existing verdict.
      const stored = debate.verdict as Verdict
      const verdict = deepDiveUnlocked ? await withDeepDive(supabaseAdmin(), debateId, stored) : stored
      return NextResponse.json({ verdict })
    }

    const isHuman = debate.opponent === 'human'
    const versus = (debate.versus ?? {}) as Partial<VersusConfig>
    const first: HumanSpeaker = versus.first === 'guest' ? 'guest' : 'host'

    const rounds = (debate.rounds ?? []) as RoundEntry[]
    const complete = isHuman
      ? nextHumanTurn(rounds, first) === null
      : ROUND_ORDER.every((round) =>
          ['user', 'ai'].every((speaker) =>
            rounds.some((r) => r.round === round && r.speaker === speaker)
          )
        )
    if (!complete) {
      return NextResponse.json({ error: 'debate is not finished' }, { status: 409 })
    }

    // H2H display names: host = account username, guest = the name typed at
    // setup. Kept out of the vs-AI path entirely.
    let hostName = 'Debater A'
    let guestName = 'Debater B'
    if (isHuman) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', debate.user_id)
        .single()
      hostName = prof?.username || 'The host'
      guestName = versus.guest_name?.trim() || 'The challenger'
    }

    const isRanked = isHuman && Boolean(debate.opponent_user_id)

    const judgeInput: JudgeInput = {
      isHuman,
      isRanked,
      userSide: debate.user_side ?? '',
      guestSide: versus.guest_side?.trim() ?? '',
      hostName,
      guestName,
      rounds,
      first,
      grounding: '',
    }

    // Best-effort real facts for any named players: career and postseason
    // averages, honours, and which team they play for now. Never blocks judging
    // if a lookup fails. The transcript is read only to harvest player names, so
    // either seating serves here.
    judgeInput.grounding = await buildGroundingBlock(
      debate.topic_text,
      buildTranscript(judgeInput, { variant: PRODUCTION_VARIANT, swap: false })
    )

    // Judged in BOTH seatings and averaged, so nobody gains from being the one
    // called "Debater A" (the old single-pass judge reversed itself on half of
    // all debates when only the labels changed). The judge is never told which
    // side is the AI, which is why the real labels are handed in here for it to
    // write back into the note afterwards.
    const verdict = await judgeDebate(judgeInput, debate.topic_text, {
      holder: isHuman
        ? { subject: hostName, possessive: `${hostName}'s` }
        : { subject: 'you', possessive: 'your' },
      other: isHuman
        ? { subject: guestName, possessive: `${guestName}'s` }
        : { subject: 'the AI', possessive: "the AI's" },
    })
    if (!verdict) {
      return NextResponse.json({ error: 'judge returned no verdict' }, { status: 502 })
    }
    // Prose to its own table first, so it is there by the time the row says
    // the debate is judged; the row gets the verdict without it.
    await saveDeepDive(supabaseAdmin(), debateId, verdict)
    const storedVerdict = stripDeepDive(verdict)

    // ── Ranked online H2H: settle both seats through the shared path ──
    // (guarded verdict write + decayed flat payout + founding boost + stats,
    // H2H ledger and badges for BOTH players). Exhibition and vs-AI debates
    // fall through to the original flow below.
    if (isRanked) {
      const settled = await settleRankedH2H(supabaseAdmin(), {
        debateId,
        hostId: debate.user_id,
        guestId: debate.opponent_user_id!,
        verdict: storedVerdict,
        awardBadges: true,
      })
      if (!settled) {
        // Lost the race: another call already judged + awarded.
        return NextResponse.json({
          verdict: forCaller(verdict),
          ranked: true,
          pointsHost: 0,
          pointsGuest: 0,
          hostBadges: [],
          guestBadges: [],
        })
      }
      return NextResponse.json({
        verdict: forCaller(verdict),
        ranked: true,
        pointsHost: settled.hostDelta,
        pointsGuest: settled.guestDelta,
        hostBadges: settled.hostBadges,
        guestBadges: settled.guestBadges,
      })
    }

    const won = verdict.winner === 'user'
    // The judge returns THREE outcomes and this route used to collapse them into
    // two, so a draw was settled as a full loss: -25 points, losses+1, streak
    // reset, while the arena and the hub both rendered TIE. lib/h2h-settle.ts
    // already treats a tie as "record the verdict, move nothing", so the two
    // settlement paths disagreed about the same word. This one now matches it.
    const tied = verdict.winner === 'none'
    const difficulty = (debate.difficulty ?? 'starter') as Difficulty
    const isRandom = Boolean(debate.is_random)

    // Founding members get a permanent +20% boost on point GAINS. Read it now
    // (own row, readable under RLS) so the boost is baked into points_earned
    // before it's written to the debate row. applyFounding no-ops on losses.
    const { data: founderRow } = await supabase
      .from('profiles')
      .select('is_founding')
      .eq('id', debate.user_id)
      .single()
    const isFounding = Boolean(founderRow?.is_founding)

    // Positive on a win (scaled by difficulty + random bonus, then the founding
    // boost), negative on a loss, zero on a draw. H2H exhibitions are always 0:
    // no points ever change hands.
    const pointsEarned =
      isHuman || tied
        ? 0
        : applyFounding(pointsDelta(won ? 'win' : 'loss', difficulty, isRandom), isFounding)

    // Service role: write verdict + scores + points. The `.is('verdict', null)`
    // filter plus `.select()` is the double-submit guard: only the FIRST judge
    // call updates a row. If a racing second call gets 0 rows back, another call
    // already awarded points, so we bail before touching profile stats again.
    const admin = supabaseAdmin()
    const { data: written, error: writeError } = await admin
      .from('debates')
      .update({
        verdict: storedVerdict,
        user_score: verdict.user_score,
        opponent_score: verdict.ai_score,
        winner: verdict.winner,
        points_earned: pointsEarned,
        status: 'complete',
      })
      .eq('id', debateId)
      .is('verdict', null)
      .select('id')
    if (writeError) {
      console.error('verdict write failed', writeError)
      return NextResponse.json({ error: 'failed to save verdict' }, { status: 500 })
    }
    if (!written || written.length === 0) {
      // Lost the race: another call already judged + awarded. Return the verdict
      // without double-counting points or badges.
      return NextResponse.json({ verdict: forCaller(verdict), pointsEarned, difficulty, newBadges: [], founding: isFounding })
    }

    // Draw: the verdict is written and the debate is complete, but nothing moves
    // on the profile. No points, no win, no loss, and the streak is left where it
    // was rather than being broken by a debate nobody lost. Same rule as the
    // ranked path in lib/h2h-settle.ts.
    if (tied) {
      return NextResponse.json({ verdict: forCaller(verdict), pointsEarned: 0, difficulty, newBadges: [], founding: isFounding })
    }

    // Exhibition rule: an H2H verdict changes nothing on the profile.
    // No points, no wins/losses, no streak, no badges.
    if (isHuman) {
      return NextResponse.json({ verdict: forCaller(verdict), pointsEarned: 0, difficulty, newBadges: [] })
    }

    let newBadges: AwardedBadge[] = []
    const { data: profile } = await admin
      .from('profiles')
      .select('points, wins, losses, current_streak, best_streak, h2h_wins')
      .eq('id', debate.user_id)
      .single()
    if (profile) {
      const streak = won ? profile.current_streak + 1 : 0
      const after = {
        points: Math.max(0, profile.points + pointsEarned), // never negative
        wins: profile.wins + (won ? 1 : 0),
        losses: profile.losses + (won ? 0 : 1),
        current_streak: streak,
        best_streak: Math.max(profile.best_streak, streak),
      }
      await admin.from('profiles').update(after).eq('id', debate.user_id)

      // Tiers key off BEST streak, not the current one: a family that levels up
      // and then levels back down the moment you lose is a punishment, not a
      // badge. Daily stats are deliberately absent here, so those families are
      // simply not evaluated on this path (see BadgeStats).
      newBadges = await awardBadges(admin, debate.user_id, {
        won,
        userScore: verdict.user_score,
        difficulty,
        wins: after.wins,
        bestStreak: after.best_streak,
        points: after.points,
        decidedDebates: after.wins + after.losses,
        h2hWins: profile.h2h_wins,
      })
    }

    return NextResponse.json({ verdict: forCaller(verdict), pointsEarned, difficulty, newBadges, founding: isFounding })
  } catch (err) {
    console.error('judge route error', err)
    return NextResponse.json({ error: 'judging failed' }, { status: 500 })
  }
}
