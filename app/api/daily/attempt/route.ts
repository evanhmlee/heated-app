import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'
import { getOrCreateTodayPrompt } from '@/lib/daily'
import { isInappropriate } from '@/lib/moderation'
import { MAX_DAILY_CHARS } from '@/lib/debate'
import { DAILY_ELITE_SCORE } from '@/lib/badges'
import { awardBadges } from '@/lib/badge-award'
import { buildDailySystemPrompt, buildDailyUserMessage, dailyScore } from '@/lib/daily-prompt'
import { buildGroundingBlock } from '@/lib/nba-grounding'

export const maxDuration = 60

// No `score` field: the overall grade is derived from the three dimensions by
// dailyScore(). Asking a model for a breakdown AND a total gets you a total that
// does not follow from the breakdown, and the breakdown is the half with the
// reasoning behind it.
type Grade = { facts: number; logic: number; delivery: number; note: string }

// POST { argument, side? }: grade one daily take (no AI opponent) and record it.
// One attempt per user per day (enforced by the unique constraint + a pre-check).
// Score is server-computed with the service role so it can never be forged.
export async function POST(request: Request) {
  try {
    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const argument = String(body?.argument ?? '').trim().slice(0, MAX_DAILY_CHARS)
    const rawSide = body?.side ? String(body.side).slice(0, 120) : null
    if (!argument) {
      return NextResponse.json({ error: 'say something' }, { status: 400 })
    }

    // Moderation BEFORE consuming the attempt: a flagged take is rejected (400)
    // and no row is written, so the user can resubmit clean. Unlike a ranked
    // debate there's no auto-loss penalty here (nothing is on the line but a
    // leaderboard slot), and we never store flagged content.
    if (isInappropriate(argument)) {
      return NextResponse.json({ error: 'flagged', flagged: true }, { status: 400 })
    }

    const admin = supabaseAdmin()
    const prompt = await getOrCreateTodayPrompt(admin)
    if (!prompt) return NextResponse.json({ error: 'no daily prompt' }, { status: 502 })

    // An open day has no sides, so a `side` in the body is either a stale client
    // or someone hand-rolling a request. Dropped rather than rejected: the take
    // itself is fine and the side is only framing, but storing it would put a
    // position on the feed that the prompt never offered.
    const openEnded = prompt.format === 'open'
    const side = openEnded ? null : rawSide

    // One attempt each. The unique constraint is the real guard (below); this is
    // the friendly early-out.
    const { data: existing } = await supabase
      .from('daily_attempts')
      .select('score')
      .eq('daily_prompt_id', prompt.id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'already played', alreadyPlayed: true }, { status: 409 })
    }

    // Real career, playoff and current-team facts for any player the take names.
    // The daily grader ran without this entirely, so it was scoring stat claims
    // against the model's own out-of-date memory on the one screen where the
    // result is public and ranked. Best-effort: a failed lookup degrades to
    // ungrounded scoring rather than failing the attempt.
    const grounding = await buildGroundingBlock(prompt.topic, argument)

    // Single-take grader: temperature 0 (score consistency, same rule as the
    // debate judge). Injection defense: the take is wrapped in <take> tags and
    // is content, never instructions.
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      temperature: 0,
      system: buildDailySystemPrompt(),
      messages: [
        {
          role: 'user',
          content: buildDailyUserMessage(prompt.topic, side, argument, grounding, openEnded),
        },
      ],
    })

    const block = response.content[0]
    const raw = block?.type === 'text' ? block.text : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'grading failed' }, { status: 502 })
    }
    // Validate the grade BEFORE the insert. One take per day is enforced by a
    // unique constraint, so a malformed grade that got written would be a
    // permanent FACTS 0 / LOGIC 0 / DELIVERY 0 the player can never retry,
    // sitting last on a public board. Refusing here returns a 502, which the
    // client already treats as "try again" with nothing spent.
    let parsed: Grade
    try {
      parsed = JSON.parse(jsonMatch[0]) as Grade
    } catch {
      return NextResponse.json({ error: 'grading failed' }, { status: 502 })
    }
    const isScore = (n: unknown) =>
      (typeof n === 'number' || (typeof n === 'string' && n.trim() !== '')) && Number.isFinite(Number(n))
    if (!parsed || ![parsed.facts, parsed.logic, parsed.delivery].every(isScore)) {
      console.error('daily grade came back off-shape', raw.slice(0, 300))
      return NextResponse.json({ error: 'grading failed' }, { status: 502 })
    }
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)))
    // Backstop for the no-em-dash prompt rule (see judge route): strip any that
    // slip through, since the note shows on the daily board and share surfaces.
    const stripDashes = (s: string) => s.replace(/[–—]\s*/g, ', ').replace(/,\s*$/, '')
    // Mean of the three dimensions, so the headline number and the breakdown
    // rendered under it on the daily board can never disagree.
    const score = dailyScore(parsed)
    const breakdown = {
      facts: clamp(parsed.facts),
      logic: clamp(parsed.logic),
      delivery: clamp(parsed.delivery),
      note: stripDashes(String(parsed.note ?? '')),
    }

    // Insert with the service role. The unique (daily_prompt_id, user_id)
    // constraint is the race backstop: a duplicate is a code 23505, which we
    // translate back to "already played" rather than 500.
    const { error: insertErr } = await admin.from('daily_attempts').insert({
      daily_prompt_id: prompt.id,
      user_id: user.id,
      side,
      argument,
      score,
      breakdown,
    })
    if (insertErr) {
      if (insertErr.code === '23505') {
        return NextResponse.json({ error: 'already played', alreadyPlayed: true }, { status: 409 })
      }
      console.error('daily attempt insert failed', insertErr)
      return NextResponse.json({ error: 'could not save take' }, { status: 500 })
    }

    // Counted from daily_attempts rather than incremented, so a backfill or a
    // deleted attempt can never leave a tier stranded above what the user has
    // actually done. The insert above has already landed, so both counts include
    // this take. Failures here return [] and never affect the graded score.
    const [{ count: takes }, { count: highScores }] = await Promise.all([
      admin
        .from('daily_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      admin
        .from('daily_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('score', DAILY_ELITE_SCORE),
    ])
    const newBadges = await awardBadges(admin, user.id, {
      dailyTakes: takes ?? 0,
      dailyHighScores: highScores ?? 0,
    })

    return NextResponse.json({ score, breakdown, newBadges })
  } catch (err) {
    console.error('daily attempt route error', err)
    return NextResponse.json({ error: 'grading failed' }, { status: 500 })
  }
}
