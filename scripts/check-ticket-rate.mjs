// Asserts the lib/tickets.ts rate table against public.ticket_rate() in the
// live database.
//
// lib/tickets.ts says the two "are asserted against each other by nothing but
// this comment". That held until the free rate moved from 48h to a week and
// the UI would have promised a refill the database does not honour. This is
// that assertion, made real.
//
//   node scripts/check-ticket-rate.mjs
//
// Exits non-zero on drift so it can gate a deploy.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const tmp = '.ticket-rate-check.mjs'
writeFileSync(tmp, stripTypeScriptTypes(readFileSync('lib/tickets.ts', 'utf8')))
const { TICKET_RATES } = await import(pathToFileURL(tmp).href)
unlinkSync(tmp)

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

let bad = 0
for (const [tier, isPro] of [['free', false], ['pro', true]]) {
  const { data, error } = await db.rpc('ticket_rate', { p_is_pro: isPro })
  if (error) {
    console.error(`  ${tier}: could not read ticket_rate() - ${error.message}`)
    bad++
    continue
  }
  const row = Array.isArray(data) ? data[0] : data
  const mirror = TICKET_RATES[tier]
  const capOk = row.bank_cap === mirror.bankCap
  const refillOk = row.refill_seconds === mirror.refillSeconds
  const mark = capOk && refillOk ? 'OK  ' : 'DRIFT'
  console.log(
    `${mark} ${tier.padEnd(5)} db: cap ${row.bank_cap}, refill ${row.refill_seconds}s` +
      `  |  lib: cap ${mirror.bankCap}, refill ${mirror.refillSeconds}s`
  )
  if (!capOk || !refillOk) bad++
}

if (bad) {
  console.error(`\n${bad} tier(s) drifted. lib/tickets.ts and public.ticket_rate() must move together.`)
  process.exit(1)
}
console.log('\nrate table matches the database.')
