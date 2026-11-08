import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { todayDate } from '@/lib/daily'
import { DAILY_WIN_BONUS, applyFounding } from '@/lib/debate'
import { awardBadges } from '@/lib/badge-award'

export const maxDuration = 60

// End-of-day award job (Vercel Cron, see vercel.json — runs 00:05 UTC daily).
// For every daily prompt whose day has closed and that has not been awarded yet,
// award DAILY_WIN_BONUS points to the single highest scorer (earliest submission
// breaks ties). Idempotent: the awarded_at guard means a re-run awards nothing.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET
// is set. We require it. (A missing CRON_SECRET fails closed — set it in Vercel.)
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const admin = supabaseAdmin()
    const today = todayDate()

    // Closed days (strictly before today, UTC) that still need awarding.
    const { data: prompts, error } = await admin
      .from('daily_prompts')
      .select('id, prompt_date')
      .lt('prompt_date', today)
      .is('awarded_at', null)
    if (error) {
      console.error('award-daily: prompt query failed', error)
      return NextResponse.json({ error: 'query failed' }, { status: 500 })
    }

    const awarded: { date: string; winner: string; score: number }[] = []

    for (const prompt of prompts ?? []) {
      // Top attempt for the day: highest score, earliest submission wins ties.
      const { data: top } = await admin
        .from('daily_attempts')
        .select('user_id, score')
        .eq('daily_prompt_id', prompt.id)
        .order('score', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      // Claim the prompt first (idempotency guard). If another run already
      // awarded it, this updates 0 rows and we skip the points.
      const { data: claimed } = await admin
        .from('daily_prompts')
        .update({ winner_user_id: top?.user_id ?? null, awarded_at: new Date().toISOString() })
        .eq('id', prompt.id)
        .is('awarded_at', null)
        .select('id')
      if (!claimed || claimed.length === 0) continue

      // No attempts that day: mark it awarded (above) with no winner, move on.
      if (!top) continue

      const { data: profile } = await admin
        .from('profiles')
        .select('points, is_founding')
        .eq('id', top.user_id)
        .single()
      if (profile) {
        // Founding members get the +20% boost on the daily bonus too.
        const bonus = applyFounding(DAILY_WIN_BONUS, Boolean(profile.is_founding))
        const points = profile.points + bonus
        await admin.from('profiles').update({ points }).eq('id', top.user_id)

        // Crowns are counted from the source of truth rather than incremented,
        // so a re-run or a backfill can never inflate the tier. The claim above
        // already ran, so this count includes the day just awarded.
        const { count: crowns } = await admin
          .from('daily_prompts')
          .select('id', { count: 'exact', head: true })
          .eq('winner_user_id', top.user_id)

        await awardBadges(admin, top.user_id, {
          points,
          dailyCrowns: crowns ?? 0,
        })
      }
      awarded.push({ date: prompt.prompt_date, winner: top.user_id, score: top.score })
    }

    return NextResponse.json({ awarded, count: awarded.length })
  } catch (err) {
    console.error('award-daily route error', err)
    return NextResponse.json({ error: 'award failed' }, { status: 500 })
  }
}
