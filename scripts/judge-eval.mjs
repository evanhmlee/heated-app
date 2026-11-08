// Judge bias harness. Replays real judged debates through the judge prompt
// twice: once as-is, once with the two debaters' LABELS swapped. A fair judge
// mirrors itself, so every point of asymmetry it reports is bias.
//
//   node scripts/judge-eval.mjs --variant legacy
//   node scripts/judge-eval.mjs --variant debiased --limit 6
//
// Metrics:
//   flip rate      how often the WINNER changes identity when the labels swap.
//                  A fair judge scores 0%. Anything here is a debate whose
//                  result was decided by seating, not by argument.
//   slot A edge    mean(slot A score) - mean(slot B score) pooled over both
//                  arms. Because every debate is judged in both seats, the
//                  arguments are perfectly balanced across slots, so a non-zero
//                  number is positional advantage and nothing else.
//   mirror error   mean |score(party, normal) - score(party, swapped)|. How far
//                  the judge moves a fixed argument for no reason at all.
//   spread         distinct score values and stdev. The production judge put 13
//                  of its first 17 human scores on 72 or 78; this is whether the
//                  scale has been un-collapsed.
//
// Reads REAL debate transcripts from the DB with the service role and never
// writes anything back. Grounding is deliberately passed as empty: it would be
// identical in both arms, so it cannot affect a difference measurement, and
// leaving it out keeps a run cheap and hermetic.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '.judge-eval')

// ── env ───────────────────────────────────────────────────────────
for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

// ── load the REAL prompt code ─────────────────────────────────────
// Node can strip TypeScript types but not resolve extensionless relative
// imports, so each module is stripped to a sibling .mjs and its specifiers are
// rewritten. This is what makes the harness test the shipped prompt instead of
// a copy that silently drifts out of sync with it.
mkdirSync(OUT, { recursive: true })
function loadTs(name) {
  const src = readFileSync(path.join(ROOT, 'lib', `${name}.ts`), 'utf8')
  const js = stripTypeScriptTypes(src).replace(/from '\.\/([a-z-]+)'/g, "from './$1.mjs'")
  const dest = path.join(OUT, `${name}.mjs`)
  writeFileSync(dest, js)
  return dest
}
loadTs('debate')
const promptMod = await import(pathToFileURL(loadTs('judge-prompt')).href)
const { buildJudgeUserMessage, buildJudgeSystemPrompt, rubricTotal, PRODUCTION_VARIANT } = promptMod

// ── args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const arg = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
// Defaults to whatever production ships, so a bare run always measures the
// live judge and only an explicit --variant legacy reproduces the old baseline.
const VARIANT = arg('--variant', PRODUCTION_VARIANT)
const LIMIT = Number(arg('--limit', '100'))
const CONCURRENCY = Number(arg('--concurrency', '4'))

// ── data ──────────────────────────────────────────────────────────
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const { data: debates, error } = await db
  .from('debates')
  .select('id, opponent, opponent_user_id, topic_text, user_side, rounds, versus')
  .not('verdict', 'is', null)
  .order('created_at', { ascending: false })
if (error) throw error

// Six turns or it is not a complete debate; a forfeited stub tells us nothing
// about bias and would dominate the spread numbers with its 0/100.
const usable = debates.filter((d) => Array.isArray(d.rounds) && d.rounds.length === 6).slice(0, LIMIT)
console.log(`variant=${VARIANT}  debates=${usable.length} (of ${debates.length} judged)\n`)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function inputFor(d) {
  const versus = d.versus ?? {}
  return {
    isHuman: d.opponent === 'human',
    isRanked: d.opponent === 'human' && Boolean(d.opponent_user_id),
    userSide: d.user_side ?? '',
    guestSide: versus.guest_side ?? '',
    hostName: 'Riley',
    guestName: 'Jordan',
    rounds: d.rounds,
    first: versus.first === 'guest' ? 'guest' : 'host',
    grounding: '',
  }
}

// One judged run. Returns scores keyed by REAL party (holder = the account
// holder, other = the AI or the guest), which is what makes the two arms
// comparable at all.
async function judge(d, swap) {
  const input = inputFor(d)
  const opts = { variant: VARIANT, swap }
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1600,
    temperature: 0,
    system: buildJudgeSystemPrompt(input, opts),
    messages: [{ role: 'user', content: buildJudgeUserMessage(input, opts, d.topic_text) }],
  })
  const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('no JSON in judge response')
  const p = JSON.parse(m[0])

  const aScore =
    VARIANT === 'legacy' ? p.user_score : VARIANT === 'rubric' ? rubricTotal(p.debater_a) : p.debater_a_score
  const bScore =
    VARIANT === 'legacy' ? p.ai_score : VARIANT === 'rubric' ? rubricTotal(p.debater_b) : p.debater_b_score
  const winnerSlot =
    p.winner === 'user' || p.winner === 'debater_a'
      ? 'a'
      : p.winner === 'opponent' || p.winner === 'debater_b'
        ? 'b'
        : 'none'

  // Slot -> real party.
  const holderSlot = swap ? 'b' : 'a'
  return {
    holder: swap ? bScore : aScore,
    other: swap ? aScore : bScore,
    slotA: aScore,
    slotB: bScore,
    winner: winnerSlot === 'none' ? 'none' : winnerSlot === holderSlot ? 'holder' : 'other',
  }
}

// ── run ───────────────────────────────────────────────────────────
const results = []
for (let i = 0; i < usable.length; i += CONCURRENCY) {
  const batch = usable.slice(i, i + CONCURRENCY)
  const done = await Promise.all(
    batch.map(async (d) => {
      try {
        const [normal, swapped] = await Promise.all([judge(d, false), judge(d, true)])
        return { d, normal, swapped }
      } catch (err) {
        console.error(`  ! ${d.id.slice(0, 8)} ${err.message}`)
        return null
      }
    })
  )
  for (const r of done.filter(Boolean)) {
    results.push(r)
    const flip = r.normal.winner !== r.swapped.winner
    console.log(
      `${flip ? 'FLIP' : '    '} ${r.d.id.slice(0, 8)} ${r.d.opponent.padEnd(5)} ` +
        `normal ${String(r.normal.holder).padStart(3)}-${String(r.normal.other).padEnd(3)} ${r.normal.winner.padEnd(6)} | ` +
        `swapped ${String(r.swapped.holder).padStart(3)}-${String(r.swapped.other).padEnd(3)} ${r.swapped.winner.padEnd(6)} | ` +
        `${r.d.topic_text.slice(0, 40)}`
    )
  }
}

// ── metrics ───────────────────────────────────────────────────────
const n = results.length
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const stdev = (xs) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

const flips = results.filter((r) => r.normal.winner !== r.swapped.winner)
const slotA = results.flatMap((r) => [r.normal.slotA, r.swapped.slotA])
const slotB = results.flatMap((r) => [r.normal.slotB, r.swapped.slotB])
const mirror = results.flatMap((r) => [
  Math.abs(r.normal.holder - r.swapped.holder),
  Math.abs(r.normal.other - r.swapped.other),
])
const allScores = [...slotA, ...slotB]
const counts = new Map()
for (const s of allScores) counts.set(s, (counts.get(s) ?? 0) + 1)
const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

console.log(`\n${'='.repeat(64)}\nvariant=${VARIANT}  n=${n} debates (${n * 2} judged runs)`)
console.log(`flip rate    ${flips.length}/${n}  ${((100 * flips.length) / (n || 1)).toFixed(0)}%   (fair judge = 0%)`)
console.log(`slot A edge  ${(mean(slotA) - mean(slotB)).toFixed(2)} pts   (fair judge = 0.00)`)
console.log(`mirror error ${mean(mirror).toFixed(2)} pts avg, max ${Math.max(...mirror)}   (fair judge = 0.00)`)
console.log(`spread       ${counts.size} distinct values over ${allScores.length} scores, stdev ${stdev(allScores).toFixed(1)}`)
console.log(`most common  ${top.map(([v, c]) => `${v}x${c}`).join('  ')}`)

// What shipping DUAL-PASS would produce, computed from the two arms we already
// ran. Averaging the seatings is symmetric by construction, so its flip rate is
// 0% as a matter of arithmetic rather than as a measurement. What is worth
// measuring is how often the two seatings disagreed in the first place (that is
// the instability the average is absorbing) and how often the average lands on
// an exact tie, which the app has to render as a non-win.
const dual = results.map((r) => ({
  holder: (r.normal.holder + r.swapped.holder) / 2,
  other: (r.normal.other + r.swapped.other) / 2,
}))
const ties = dual.filter((d) => d.holder === d.other).length
const dualScores = dual.flatMap((d) => [d.holder, d.other])
console.log(`\n-- dual-pass (average both seatings) --`)
console.log(`flip rate    0%  (symmetric by construction)`)
console.log(`disagreement ${flips.length}/${n}  ${((100 * flips.length) / (n || 1)).toFixed(0)}%  seatings that disagreed and got resolved by the average`)
console.log(`exact ties   ${ties}/${n}`)
console.log(`spread       ${new Set(dualScores).size} distinct over ${dualScores.length}, stdev ${stdev(dualScores).toFixed(1)}`)
console.log('='.repeat(64))

writeFileSync(
  path.join(OUT, `results-${VARIANT}.json`),
  JSON.stringify({ variant: VARIANT, n, results }, null, 2)
)
