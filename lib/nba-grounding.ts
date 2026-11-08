import Anthropic from '@anthropic-ai/sdk'
import { getPlayerFacts } from './nba-stats'
import { getCachedCurrentTeam } from './nba-team-cache'

// Pulls real NBA player names out of a debate (topic + transcript) and fetches
// their actual career numbers, per-season lines and awards from ESPN
// (lib/nba-stats.ts) to give the judge and the AI opponent ground truth instead
// of letting either freelance on disputed facts. Entirely best-effort:
// extraction or lookup failures degrade to an empty string rather than blocking
// a debate (same "no SLA" posture as the source itself).
// Hard ceiling on the whole grounding stage. The judge route has 60s total and
// now spends it on grounding FIRST and two Sonnet passes AFTER, so a slow stage
// here does not degrade the verdict, it means there is no verdict: the route
// times out and the user lands on a finished debate that was never scored.
// Grounding is a bonus, so it gets a budget and loses the argument when it runs
// over. Sized to fit a Haiku call plus one round of ESPN fetches (10s timeouts,
// issued in parallel) with room to spare.
const GROUNDING_BUDGET_MS = 20_000

/**
 * Best-effort grounding, bounded. Returns '' if the work does not finish inside
 * GROUNDING_BUDGET_MS. The in-flight lookups are not cancelled, they are just no
 * longer waited on, so any cache write they were going to do still lands and the
 * next debate to name that player gets the fact for free.
 */
export async function buildGroundingBlock(
  topicText: string,
  transcriptText: string
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      buildGroundingBlockUnbounded(topicText, transcriptText),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => {
          console.error('nba grounding exceeded its budget, judging without it')
          resolve('')
        }, GROUNDING_BUDGET_MS)
      }),
    ])
  } finally {
    // Without this the pending timer keeps the serverless invocation alive after
    // the response has already gone out.
    if (timer) clearTimeout(timer)
  }
}

async function buildGroundingBlockUnbounded(
  topicText: string,
  transcriptText: string
): Promise<string> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      temperature: 0,
      system:
        'Extract up to 4 real NBA player full names (past or present) mentioned or clearly implied by this basketball debate. Respond with ONLY a JSON array of strings, e.g. ["LeBron James","Michael Jordan"]. No teams, no explanation, no duplicates. Empty array if none.',
      messages: [
        { role: 'user', content: `${topicText}\n\n${transcriptText}`.slice(0, 4000) },
      ],
    })
    const block = response.content[0]
    const raw = block?.type === 'text' ? block.text : '[]'
    const match = raw.match(/\[[\s\S]*\]/)
    const names: unknown[] = match ? JSON.parse(match[0]) : []

    const cleanNames = names
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .slice(0, 4)

    // Two independent best-effort lookups: CAREER detail read through to ESPN
    // (lib/nba-stats.ts) and CURRENT team from the nightly ESPN-fed roster
    // cache (lib/nba-team-cache.ts). Either can come back empty without
    // blocking the other.
    const [factGroups, teamLines] = await Promise.all([
      Promise.all(cleanNames.map((n) => getPlayerFacts(n))),
      Promise.all(cleanNames.map((n) => getCachedCurrentTeam(n))),
    ])

    // Grouped per player rather than all stats followed by all teams. It puts
    // "in 2025-26 (with the Lakers)" directly above "currently plays for the
    // 76ers", so the one genuinely confusable pair in this block is adjacent
    // and readable as two different facts instead of a contradiction.
    const lines = cleanNames.flatMap((_, i) => {
      const group = [...factGroups[i]]
      // Exactly one source may name a current team: two "currently plays for"
      // lines that disagree is worse than either alone.
      //
      // The ROSTER cache wins when it has an answer. Both sources are ESPN and
      // both are age-gated at 7 days, but the roster cache is refreshed for all
      // 544 players at once while the career row is only refreshed when someone
      // happens to debate that player, so after a trade the roster cache turns
      // over first. This precedence was backwards when current team was first
      // added and the career row could be 30 days old, which meant a user who
      // correctly named a traded player's new team was penalized against a
      // stale line carrying VERIFIED authority.
      const team = teamLines[i]
      if (team) {
        const deduped = group.filter((l) => !l.includes('currently plays for'))
        deduped.push(team)
        return deduped
      }
      return group
    })

    if (lines.length === 0) return ''
    return lines.map((l) => `- ${l}`).join('\n')
  } catch (err) {
    console.error('nba grounding failed, judging without it', err)
    return ''
  }
}
