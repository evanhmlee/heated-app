import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { DIFFICULTIES, type Difficulty } from '@/lib/debate'
import { generateTopic } from '@/lib/topic-gen'

export const maxDuration = 30

// Nicheness scales with difficulty: mainstream at Rookie, deep-cut at Hall of
// Famer. The NBA landscape keeps changing, so topics are AI-generated (Haiku —
// ~$0.001/call, fast enough for re-rolls) rather than a fixed list. Generation
// itself lives in lib/topic-gen (shared with the lobby-accept route, which
// rolls the topic for a random online H2H match). The client falls back to the
// curated TOPIC_BOARD when this route errors.
export async function POST(request: Request) {
  try {
    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const difficulty: Difficulty = DIFFICULTIES.includes(body?.difficulty)
      ? body.difficulty
      : 'starter'

    const topic = await generateTopic(difficulty)
    return NextResponse.json(topic)
  } catch (err) {
    console.error('topic route error', err)
    return NextResponse.json({ error: 'topic generation failed' }, { status: 500 })
  }
}
