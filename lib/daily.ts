import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

// Server-only helpers for the Daily Prompt. The prompt is generated lazily by
// the first request of the day and written with the service role; all callers
// (the /dashboard/daily page and the API routes) go through getOrCreateTodayPrompt
// so there is exactly one generation path.

// 'sides' carries stance_a and stance_b and renders the side-picker chips.
// 'open' is a bare question: no offered positions, say what you think. A DB
// check constraint keeps the format and the stances agreeing, so a consumer can
// branch on `format` alone and trust the stances match.
export type DailyFormat = 'sides' | 'open'

export type DailyPrompt = {
  id: string
  prompt_date: string
  format: DailyFormat
  topic: string
  stance_a: string | null
  stance_b: string | null
  winner_user_id: string | null
  awarded_at: string | null
}

const PROMPT_COLUMNS =
  'id, prompt_date, format, topic, stance_a, stance_b, winner_user_id, awarded_at'

// The "day" is a UTC calendar date (YYYY-MM-DD). Keeping it UTC means the board
// closes at 00:00 UTC and the end-of-day cron (also UTC) lines up cleanly.
export function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

const stripDashes = (s: string) => s.replace(/[–—]\s*/g, ', ').replace(/,\s*$/, '')

// Which shape of prompt a given day gets.
//
// Decided HERE rather than by asking the model to choose, which matters: a model
// handed "pick a format" picks the same one nearly every time, and the whole
// point of the mix is that the daily does not settle into one rhythm. Derived
// from the date so it is deterministic (the same day always regenerates the same
// shape) without needing any stored state.
//
// Weighted two-in-three toward open, because that is where hot takes actually
// come from. A two-sided day is the easier on-ramp for someone with no strong
// opinion, so it earns its third rather than being dropped.
//
// Measured over 90 days: 60 open, 30 sides, longest single-shape run 4 days.
// Note this lands as a rolling cycle rather than as noise, since consecutive
// dates move the sum by one: roughly every third day is two-sided, with the
// pattern breaking at month boundaries where the digits jump. That is a fine
// property (a rhythm people can learn) but it is not randomness, so do not
// describe it as random anywhere user-facing.
export function formatForDate(date: string): DailyFormat {
  let sum = 0
  for (let i = 0; i < date.length; i++) sum += date.charCodeAt(i)
  return sum % 3 === 2 ? 'sides' : 'open'
}

type Generated = { topic: string; stance_a: string | null; stance_b: string | null }

// Shared across both shapes so the two prompts cannot drift on the things that
// are not about format: scope, accessibility, and the house style rules.
const GENERATOR_RULES = `- Basketball / NBA only. Ground it in settled, well-established basketball history. Do NOT rely on live or breaking news.
- It is the prompt of the day for ALL users, so make it broadly accessible: a debate a casual fan can jump into but that still rewards a sharp argument. Not too obscure.
- No profanity. Vary the subject: do not always default to LeBron vs MJ.
- No em dashes or en dashes anywhere. Use a comma, colon, or period.`

// Generate one broadly-accessible daily basketball prompt (Haiku, ~$0.001).
// Deliberately mid-nicheness: everyone plays the SAME prompt, so it has to land
// for casual and hardcore fans alike (unlike the difficulty-scaled matchup route).
// Exported for .judge-eval/daily-format.mjs, which reads the prompt that
// actually ships rather than a copy of it. Same seam and same reason as
// lib/judge-prompt.ts and lib/daily-prompt.ts: a generator nobody can call
// outside the request path is a generator nobody checks the output of.
export async function generatePrompt(format: DailyFormat): Promise<Generated> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // The open variant asks for a question with no supplied answers on purpose.
  // Offering positions is what makes people pick one instead of saying what they
  // actually think, and a supplied position is the one thing guaranteed not to
  // be a hot take.
  const system =
    format === 'open'
      ? `You generate ONE open-ended basketball question for a DAILY hot take challenge. Every user answers the same question in their own words and an AI judge scores their argument.

Rules:
${GENERATOR_RULES}
- OPEN ENDED. Do NOT offer sides, options or a yes/no framing. Ask something that can be answered many different ways, so no two people give the same take.
- Favour questions that invite a strong, personal, arguable opinion. Prefer "who", "what", "which" and "how" over "is" and "did".
- topic is a single question, max 90 characters.
- Respond with ONLY valid JSON: {"topic": "..."}`
      : `You generate ONE basketball debate prompt for a DAILY challenge where every user argues their take and an AI judge scores it.

Rules:
${GENERATOR_RULES}
- Two clear opposing sides. "stance_a" and "stance_b" are the two positions a user could argue.
- topic is a short question or matchup, max 90 characters. Each stance is a short position, max 60 characters.
- Respond with ONLY valid JSON: {"topic": "...", "stance_a": "...", "stance_b": "..."}`

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    temperature: 1,
    system,
    messages: [{ role: 'user', content: "Generate today's basketball prompt now." }],
  })

  const block = response.content[0]
  const raw = block?.type === 'text' ? block.text : ''
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('daily prompt: no JSON')
  const parsed = JSON.parse(match[0])
  const clean = (v: unknown) => stripDashes(String(v ?? '').slice(0, 120).trim())

  const topic = clean(parsed.topic)
  if (!topic) throw new Error('daily prompt: incomplete')

  // An open day stores no stances at all, and the DB check constraint enforces
  // that. Discarding anything the model volunteered here is what keeps a chatty
  // generation from writing a row the arena would render side chips for.
  if (format === 'open') return { topic, stance_a: null, stance_b: null }

  const stance_a = clean(parsed.stance_a)
  const stance_b = clean(parsed.stance_b)
  if (!stance_a || !stance_b) throw new Error('daily prompt: incomplete')
  return { topic, stance_a, stance_b }
}

// Curated fallbacks if generation fails, so the daily is never empty. One per
// shape, because a two-sided fallback on an open day would violate the check
// constraint and turn a soft failure into a hard one.
const FALLBACKS: Record<DailyFormat, Generated> = {
  sides: {
    topic: 'Is a ring the only thing that defines an all-time great?',
    stance_a: 'Rings are the ultimate measure of greatness',
    stance_b: 'Greatness is bigger than ring count',
  },
  open: {
    topic: 'Which player is the most overrated in NBA history, and why?',
    stance_a: null,
    stance_b: null,
  },
}

// Returns today's prompt, generating and inserting it if this is the first
// request of the day. The insert races safely: ON CONFLICT (prompt_date) DO
// NOTHING means only the first caller writes; everyone re-reads the winner.
// `admin` must be a service-role client (RLS blocks client writes to this table).
export async function getOrCreateTodayPrompt(
  admin: SupabaseClient
): Promise<DailyPrompt | null> {
  const date = todayDate()

  const existing = await admin
    .from('daily_prompts')
    .select(PROMPT_COLUMNS)
    .eq('prompt_date', date)
    .maybeSingle()
  if (existing.data) return existing.data as unknown as DailyPrompt

  const format = formatForDate(date)
  let generated: Generated
  try {
    generated = await generatePrompt(format)
  } catch (err) {
    console.error('daily prompt generation failed, using fallback', err)
    generated = FALLBACKS[format]
  }

  await admin
    .from('daily_prompts')
    .insert({ prompt_date: date, format, ...generated })
    .select('id')
    // Another request may have inserted between our read and write; ignore the
    // unique-violation and re-read below.
    .then(() => undefined, () => undefined)

  const row = await admin
    .from('daily_prompts')
    .select(PROMPT_COLUMNS)
    .eq('prompt_date', date)
    .maybeSingle()
  return (row.data as unknown as DailyPrompt) ?? null
}
