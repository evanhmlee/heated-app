// Server-only AI topic generation (Haiku, ~$0.001/call), extracted from the
// /api/debate/topic route so the lobby-accept route can generate a random
// online-H2H topic at match time. Nicheness scales with difficulty.

import Anthropic from '@anthropic-ai/sdk'
import { randomTopic, type BoardTopic, type Difficulty } from '@/lib/debate'

const NICHE: Record<Difficulty, string> = {
  rookie:
    'a mainstream, casual-fan debate every NBA fan has an opinion on: the biggest superstars, championships, obvious GOAT-tier comparisons.',
  starter:
    'a popular debate with a bit more nuance: well-known players and storylines, but a question that takes a real argument.',
  all_star:
    'a deeper cut: specific playoff series, valuable role players, advanced-stat arguments, or a less-obvious comparison a serious fan would enjoy.',
  hall_of_famer:
    'a niche, deep-cut debate only a hardcore fan could argue: lesser-known players, obscure historical moments, deep eras, or analytics-heavy questions.',
}

// Throws on any failure; callers choose their own fallback behavior.
export async function generateTopic(difficulty: Difficulty): Promise<BoardTopic> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    temperature: 1,
    system: `You generate ONE basketball debate topic with two opposing sides, for an app where a user debates an AI judge.

For this request, generate ${NICHE[difficulty]}

Rules:
- Basketball / NBA only. Ground it in settled, well-established basketball history — do NOT rely on live or breaking news.
- "easySide" = the more defensible, consensus-leaning position. "hardSide" = the contrarian, tougher-to-argue position.
- topic is a short question or matchup, max 90 characters. Each side is a short stance, max 60 characters.
- No profanity. No real-time data. Do not repeat the most overused example (LeBron vs MJ) unless the difficulty is rookie and it fits.
- No em dashes or en dashes anywhere in topic, easySide, or hardSide. Use a comma, colon, or period instead.
- Respond with ONLY valid JSON: {"topic": "...", "easySide": "...", "hardSide": "..."}`,
    messages: [
      {
        role: 'user',
        content: `Generate a ${difficulty.replace('_', ' ')}-difficulty basketball debate now.`,
      },
    ],
  })

  const block = response.content[0]
  const raw = block?.type === 'text' ? block.text : ''
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('no topic generated')
  const parsed = JSON.parse(match[0])
  // Backstop for the no-em-dash prompt rule: Haiku occasionally ignores it.
  const stripDashes = (s: string) => s.replace(/[–—]\s*/g, ', ').replace(/,\s*$/, '')
  const topic = stripDashes(String(parsed.topic ?? '').slice(0, 120).trim())
  const easySide = stripDashes(String(parsed.easySide ?? '').slice(0, 120).trim())
  const hardSide = stripDashes(String(parsed.hardSide ?? '').slice(0, 120).trim())
  if (!topic || !easySide || !hardSide) throw new Error('incomplete topic')
  return { topic, easySide, hardSide }
}

// Never-fails variant: falls back to the curated board (a live match must not
// die because topic generation hiccuped).
export async function generateTopicWithFallback(difficulty: Difficulty): Promise<BoardTopic> {
  try {
    return await generateTopic(difficulty)
  } catch {
    return randomTopic()
  }
}
