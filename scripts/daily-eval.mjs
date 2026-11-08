// Daily-grader harness. The daily challenge has no opponent and no seats, so the
// position bias that dominated the debate judge cannot exist here. Two things
// can, and both decide who wins the day:
//
//   spread          distinct score values across takes of genuinely different
//                   quality. The daily leaderboard is indexed (score desc,
//                   created_at asc), so every tie breaks on submission time. A
//                   grader that puts everyone on 72 or 78 is handing the
//                   300-point daily bonus to whoever posted earliest.
//   verbosity bias  each take is graded twice: as written, and wrapped in
//                   fluent filler that adds words and zero argument. A fair
//                   grader returns the same score. Anything above zero is the
//                   grader paying for padding, on a format where the entry is
//                   someone talking into their phone for two minutes.
//
//   node scripts/daily-eval.mjs --variant legacy
//   node scripts/daily-eval.mjs --limit 12
//
// Takes are REAL user and AI turns lifted out of finished debates, because a
// standalone contention or summary is exactly the shape of a daily take, and
// synthetic takes would measure the take-writer rather than the grader.
// daily_attempts is empty, so there is no live data to use instead.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '.judge-eval')

for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

// Same trick as scripts/judge-eval.mjs: strip types off the real module rather
// than test a copy of the prompt that can drift away from what ships.
mkdirSync(OUT, { recursive: true })
function loadTs(name) {
  const src = readFileSync(path.join(ROOT, 'lib', `${name}.ts`), 'utf8')
  const js = stripTypeScriptTypes(src).replace(/from '\.\/([a-z-]+)'/g, "from './$1.mjs'")
  const dest = path.join(OUT, `${name}.mjs`)
  writeFileSync(dest, js)
  return dest
}
loadTs('debate')
const { buildDailySystemPrompt, buildDailyUserMessage, dailyScore, DAILY_PRODUCTION_VARIANT } =
  await import(pathToFileURL(loadTs('daily-prompt')).href)

const args = process.argv.slice(2)
const arg = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const VARIANT = arg('--variant', DAILY_PRODUCTION_VARIANT)
const LIMIT = Number(arg('--limit', '14'))
const CONCURRENCY = Number(arg('--concurrency', '4'))

// Fluent, confident, and completely empty: no player, no number, no claim, no
// reason. Deterministic rather than model-written so a run is reproducible and
// the padding itself cannot smuggle in an argument.
const PAD_OPEN =
  'Alright, let me lay this out properly, because I think a lot of people get this wrong and I want to be really clear about where I stand before I get into any of it. '
const PAD_CLOSE =
  ' And look, I could keep going on this for a while, there is honestly a lot more I could bring up here, but I think what I have said covers the heart of it. That is really the whole point I am making, and I would stand by it in any room, with anyone, any day of the week.'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const { data: debates, error } = await db
  .from('debates')
  .select('topic_text, rounds')
  .not('verdict', 'is', null)
if (error) throw error

// A contention states a case cold and a summary closes one, which is what a
// daily take is. Rebuttals are excluded: they answer an argument the grader
// cannot see, so a low score would be the harness's fault, not the grader's.
const MAX_BASE = 900 // leaves room for the padding under MAX_DAILY_CHARS (1500)
const takes = []
for (const d of debates) {
  for (const r of d.rounds ?? []) {
    const text = String(r.text ?? '').trim()
    if (r.round === 'rebuttal' || text.length < 200 || text.length > MAX_BASE) continue
    takes.push({ topic: d.topic_text, speaker: r.speaker, round: r.round, text })
  }
}
// Spread the sample across topics rather than taking six turns off one debate.
takes.sort((a, b) => a.topic.localeCompare(b.topic) || a.text.localeCompare(b.text))
const sample = takes.filter((_, i) => i % Math.max(1, Math.ceil(takes.length / LIMIT)) === 0).slice(0, LIMIT)
console.log(`variant=${VARIANT}  takes=${sample.length} (of ${takes.length} usable turns)\n`)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function grade(take, padded) {
  const text = padded ? `${PAD_OPEN}${take.text}${PAD_CLOSE}` : take.text
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    temperature: 0,
    system: buildDailySystemPrompt(VARIANT),
    messages: [{ role: 'user', content: buildDailyUserMessage(take.topic, null, text, '') }],
  })
  const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('no JSON in grader response')
  const p = JSON.parse(m[0])
  return { score: dailyScore(p, VARIANT), facts: p.facts, logic: p.logic, delivery: p.delivery }
}

const results = []
for (let i = 0; i < sample.length; i += CONCURRENCY) {
  const batch = sample.slice(i, i + CONCURRENCY)
  const done = await Promise.all(
    batch.map(async (t) => {
      try {
        const [plain, padded] = await Promise.all([grade(t, false), grade(t, true)])
        return { t, plain, padded }
      } catch (err) {
        console.error(`  ! ${err.message}`)
        return null
      }
    })
  )
  for (const r of done.filter(Boolean)) {
    results.push(r)
    const delta = r.padded.score - r.plain.score
    console.log(
      `${delta > 0 ? 'PAD+' : delta < 0 ? 'PAD-' : '    '} ` +
        `plain ${String(r.plain.score).padStart(3)}  padded ${String(r.padded.score).padStart(3)}  ` +
        `${delta >= 0 ? '+' : ''}${delta}  ${r.t.speaker.padEnd(5)} ${r.t.round.padEnd(10)} ${r.t.topic.slice(0, 34)}`
    )
  }
}

const n = results.length
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const stdev = (xs) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)))
const plain = results.map((r) => r.plain.score)
const deltas = results.map((r) => r.padded.score - r.plain.score)
const counts = new Map()
for (const s of plain) counts.set(s, (counts.get(s) ?? 0) + 1)
const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

console.log(`\n${'='.repeat(64)}\nvariant=${VARIANT}  n=${n} takes (${n * 2} graded runs)`)
console.log(`spread        ${counts.size} distinct over ${n} takes, stdev ${stdev(plain).toFixed(1)}, range ${Math.min(...plain)}-${Math.max(...plain)}`)
console.log(`most common   ${top.map(([v, c]) => `${v}x${c}`).join('  ')}`)
console.log(`ties          ${n - counts.size} takes share a score with another (leaderboard breaks these on submit time)`)
console.log(`verbosity     ${mean(deltas) >= 0 ? '+' : ''}${mean(deltas).toFixed(2)} pts avg for pure filler, max +${Math.max(...deltas)}   (fair grader = 0.00)`)
console.log(`              ${deltas.filter((d) => d > 0).length}/${n} takes scored HIGHER once padded`)
console.log('='.repeat(64))

writeFileSync(path.join(OUT, `daily-${VARIANT}.json`), JSON.stringify({ variant: VARIANT, n, results }, null, 2))
