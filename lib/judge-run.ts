// Running the judge, as opposed to writing its prompt (lib/judge-prompt.ts).
//
// Every debate is judged TWICE, once with each debater in the "Debater A" seat,
// and the two results are averaged. This is not belt-and-braces: measured over
// the first 16 real debates, the old single-pass judge reversed its own winner
// on half of them when the only thing that changed was which debater was called
// A. It was scoring the seat. Averaging both seatings cancels that exactly,
// because swapping the two debaters just exchanges the two passes and leaves
// every averaged number identical. Position advantage is not reduced here, it is
// arithmetically impossible.
//
// The two passes run concurrently, so this costs a second API call but very
// little extra wall clock, which matters against the route's 60s ceiling.

import Anthropic from '@anthropic-ai/sdk'
import {
  ROUND_ORDER,
  type DeepDiveEntry,
  type RubricScores,
  type Verdict,
} from './debate'
import {
  buildJudgeSystemPrompt,
  buildJudgeUserMessage,
  rubricTotal,
  PRODUCTION_VARIANT,
  type JudgeInput,
} from './judge-prompt'

type Party = 'holder' | 'other'

type Pass = {
  swap: boolean
  holder: number
  other: number
  holderParts: RubricScores
  otherParts: RubricScores
  winner: Party | 'none'
  note: string
  receipts: string[]
  deepDive: DeepDiveEntry[]
}

// Backstop for the no-em-dash prompt rule: Sonnet occasionally slips one into
// the note or receipts, and this text is the most-shared output in the app
// (verdict screen, OG card, share image).
const stripDashes = (s: string) => s.replace(/[–—]\s*/g, ', ').replace(/,\s*$/, '')

const parts = (raw: unknown): RubricScores => {
  const d = (raw ?? {}) as Partial<RubricScores>
  const clamp = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0
  return { facts: clamp(d.facts), logic: clamp(d.logic), delivery: clamp(d.delivery) }
}

// Sanitises the model's Deep Dive block. Anything malformed drops out rather
// than blocking the verdict: Deep Dive is a Pro perk, the verdict is the
// product, and a judge that 502s because one optional field came back wrong is
// a worse outcome than a debate with no breakdown attached.
//
// Exactly one entry may carry swing. The model is told that, but "the moment you
// lost it" reads as noise the moment there are two of them, so the first wins.
function parseDeepDive(raw: unknown): DeepDiveEntry[] {
  if (!Array.isArray(raw)) return []
  let swingTaken = false
  return raw
    .slice(0, ROUND_ORDER.length)
    .map((entry) => {
      const e = entry as Partial<DeepDiveEntry> | null
      const round = e?.round
      const verdict = stripDashes(String(e?.verdict ?? '')).trim()
      if (!verdict || !ROUND_ORDER.includes(round as (typeof ROUND_ORDER)[number])) return null
      const swing = e?.swing === true && !swingTaken
      if (swing) swingTaken = true
      return { round: round as DeepDiveEntry['round'], verdict, swing }
    })
    .filter((e): e is DeepDiveEntry => e !== null)
}

// One seating. Returns null rather than throwing so a single failed pass
// degrades to a single-pass verdict instead of failing the whole debate.
async function runPass(
  anthropic: Anthropic,
  input: JudgeInput,
  topicText: string,
  swap: boolean
): Promise<Pass | null> {
  try {
    const opts = { variant: PRODUCTION_VARIANT, swap }
    // Prompt caching is deliberately NOT enabled here yet, even though the
    // system prompt is now a byte-identical 1,535-token block and therefore
    // eligible (Sonnet's minimum prefix is 1,024). A cache write costs 1.25x and
    // a read 0.1x on a 5-minute TTL, so below roughly one debate every five
    // minutes every request pays the write premium and almost none reads: at
    // today's volume it would cost more, not less. Two passes firing
    // concurrently cannot share a write either, since an entry is not readable
    // until the first response starts streaming.
    //
    // To turn it on when traffic justifies it, add to this call:
    //     system: [{ type: 'text', text: <system>, cache_control: { type: 'ephemeral' } }]
    // and nothing else needs to move, which is the entire point of the reorder.
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1600,
      temperature: 0,
      system: buildJudgeSystemPrompt(input, opts),
      messages: [{ role: 'user', content: buildJudgeUserMessage(input, opts, topicText) }],
    })
    const block = response.content[0]
    const raw = block?.type === 'text' ? block.text : ''
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    const p = JSON.parse(match[0]) as Record<string, unknown>

    const aParts = parts(p.debater_a)
    const bParts = parts(p.debater_b)
    const aScore = rubricTotal(aParts)
    const bScore = rubricTotal(bParts)
    if (!aScore && !bScore) return null // nothing usable came back

    // Slot -> party. The account holder sits in B when swapped.
    const winnerSlot = p.winner === 'debater_a' ? 'a' : p.winner === 'debater_b' ? 'b' : 'none'
    const holderSlot = swap ? 'b' : 'a'
    return {
      swap,
      holder: swap ? bScore : aScore,
      other: swap ? aScore : bScore,
      holderParts: swap ? bParts : aParts,
      otherParts: swap ? aParts : bParts,
      winner: winnerSlot === 'none' ? 'none' : winnerSlot === holderSlot ? 'holder' : 'other',
      note: stripDashes(String(p.note ?? '')),
      receipts: Array.isArray(p.receipts)
        ? p.receipts.slice(0, 4).map((r) => stripDashes(String(r)))
        : [],
      deepDive: parseDeepDive(p.deep_dive),
    }
  } catch (err) {
    console.error('judge pass failed', { swap }, err)
    return null
  }
}

// ── Relabelling ───────────────────────────────────────────────────
// The judge is blind: it never learns which debater is the human, the AI or the
// guest, so it writes about "Debater A" and "Debater B". Those are swapped in
// half the passes and mean nothing to a player, so the real labels go back in
// here. Possessives must be replaced BEFORE the bare form, since \b matches
// between the A and the apostrophe and would otherwise leave a stray "you's".

type Label = { subject: string; possessive: string }

export function relabel(text: string, a: Label, b: Label): string {
  const rx = (slot: 'a' | 'b', possessive: boolean) =>
    new RegExp(`\\bdebater\\s+${slot}${possessive ? "['’]s" : ''}\\b`, 'gi')
  // Replacer FUNCTIONS, not replacement strings. A label is user-controlled: the
  // H2H guest name is free text typed at setup (trimmed and capped at 24 chars,
  // nothing more), and in a replacement string "$&", "$`", "$'" and "$$" are
  // special. A guest called "$&" would have every mention of them rewritten back
  // into "Debater B". Usernames are DB-constrained to [A-Za-z0-9_] and are safe,
  // but guest names are not, and the two arrive here through the same parameter.
  const out = text
    .replace(rx('a', true), () => a.possessive)
    .replace(rx('b', true), () => b.possessive)
    .replace(rx('a', false), () => a.subject)
    .replace(rx('b', false), () => b.subject)
  // "Debater A held the line" -> "you held the line" -> "You held the line".
  return out.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase())
}

export const TIE_NOTE =
  'Too close to separate. Both sides landed, neither did enough to take it outright, so this one goes down level.'

/**
 * The note that ships with a verdict. Normally the narrating pass's own note,
 * except on a draw the narrator did not itself call a draw, where that note
 * argues an outcome the scoreline contradicts. Exported so the tie branch has
 * test coverage: draws are rare enough (0 in 16 measured debates) that live
 * testing will not exercise it.
 */
export function noteForOutcome(
  winner: 'holder' | 'other' | 'none',
  narratorWinner: 'holder' | 'other' | 'none',
  narratorNote: string
): string {
  return winner === 'none' && narratorWinner !== 'none' ? TIE_NOTE : narratorNote
}

/**
 * Judge a finished debate. Runs both seatings concurrently, averages them, and
 * returns the app's normal Verdict shape (`user_score` = the account holder).
 * Returns null only if BOTH passes failed to produce anything parseable.
 */
export async function judgeDebate(
  input: JudgeInput,
  topicText: string,
  labels: { holder: Label; other: Label }
): Promise<Verdict | null> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const settled = await Promise.all([
    runPass(anthropic, input, topicText, false),
    runPass(anthropic, input, topicText, true),
  ])
  const passes = settled.filter((p): p is Pass => p !== null)
  if (!passes.length) return null

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const avgParts = (xs: RubricScores[]): RubricScores => ({
    facts: Math.round(mean(xs.map((x) => x.facts))),
    logic: Math.round(mean(xs.map((x) => x.logic))),
    delivery: Math.round(mean(xs.map((x) => x.delivery))),
  })

  const holderScore = Math.round(mean(passes.map((p) => p.holder)))
  const otherScore = Math.round(mean(passes.map((p) => p.other)))
  const winner: Party | 'none' =
    holderScore > otherScore ? 'holder' : otherScore > holderScore ? 'other' : 'none'

  // Take the narrative from a pass that AGREES with the averaged result. When
  // the two seatings split, the losing pass's note argues the opposite outcome,
  // and a verdict whose scoreline contradicts its own explanation is worse than
  // either result on its own.
  const narrator = passes.find((p) => p.winner === winner) ?? passes[0]

  // The one case the line above cannot satisfy. A draw almost never comes from
  // a pass DECLARING a draw; it comes from averaging two passes that each named
  // a side, so no pass agrees with 'none' and the fallback hands back a note
  // arguing someone won, underneath a scoreboard reading TIE.
  //
  // The fix is not to adopt that pass's winner: passes[0] is always the
  // unswapped seating, so breaking ties toward it would quietly reintroduce the
  // seat advantage the averaging exists to remove, in exactly the debates that
  // are closest. Keeping 'none' stays symmetric, so the note is what gives way.
  // Receipts and the deep dive are kept: they describe moments and per-section
  // winners, which are all still true of a debate that finished level.
  const noteText = noteForOutcome(winner, narrator.winner, narrator.note)
  const [aLabel, bLabel] = narrator.swap
    ? [labels.other, labels.holder]
    : [labels.holder, labels.other]

  return {
    user_score: holderScore,
    ai_score: otherScore,
    winner: winner === 'holder' ? 'user' : winner === 'other' ? 'opponent' : 'none',
    note: relabel(noteText, aLabel, bLabel),
    receipts: narrator.receipts.map((r) => relabel(r, aLabel, bLabel)),
    deep_dive: narrator.deepDive.map((d) => ({ ...d, verdict: relabel(d.verdict, aLabel, bLabel) })),
    breakdown: {
      user: avgParts(passes.map((p) => p.holderParts)),
      ai: avgParts(passes.map((p) => p.otherParts)),
    },
  }
}
