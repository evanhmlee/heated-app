import { NextResponse } from 'next/server'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'
import { getOrCreateTodayPrompt } from '@/lib/daily'

export const maxDuration = 30

// GET: today's daily prompt (generating it on first request of the day) plus the
// caller's existing attempt, if any. Auth-gated: the daily is a signed-in feature.
export async function GET() {
  try {
    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const prompt = await getOrCreateTodayPrompt(supabaseAdmin())
    if (!prompt) {
      return NextResponse.json({ error: 'no daily prompt' }, { status: 502 })
    }

    // The caller's attempt (RLS-open select). Drives the "already played" state.
    const { data: myAttempt } = await supabase
      .from('daily_attempts')
      .select('score, side, breakdown, created_at')
      .eq('daily_prompt_id', prompt.id)
      .eq('user_id', user.id)
      .maybeSingle()

    return NextResponse.json({
      prompt: {
        id: prompt.id,
        prompt_date: prompt.prompt_date,
        format: prompt.format,
        topic: prompt.topic,
        stance_a: prompt.stance_a,
        stance_b: prompt.stance_b,
      },
      myAttempt: myAttempt ?? null,
    })
  } catch (err) {
    console.error('daily today route error', err)
    return NextResponse.json({ error: 'failed to load daily' }, { status: 500 })
  }
}
