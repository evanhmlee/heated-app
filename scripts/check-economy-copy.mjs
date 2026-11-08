// Fails when a ticket-economy number is hand-typed into user-facing prose
// instead of interpolated from lib/tickets.ts.
//
// check-ticket-rate.mjs asserts lib/tickets.ts against the database. Nothing
// asserted the COPY against lib/tickets.ts, which is how "Pro banks 50"
// survived the cap moving to 25 and sat on the deck, the one screen a free
// user sees every session, overselling the plan by 2x while /upgrade said 25
// on the very next tap. Four separate reviewers filed it as four findings.
//
//   node scripts/check-economy-copy.mjs
//
// Exits non-zero on a hit so it can gate a deploy.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'

const ROOTS = ['app', 'components']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist'])

// Values the database actually enforces, read from the one file that owns them.
const src = stripTypeScriptTypes(readFileSync('lib/tickets.ts', 'utf8'))
const TICKET_RATES = new Function(
  src.replace(/^export /gm, '') + '\nreturn TICKET_RATES;'
)()

const NUMBERS = [
  { value: TICKET_RATES.pro.bankCap, what: 'the Pro bank cap' },
  { value: TICKET_RATES.free.bankCap, what: 'the free bank cap' },
]

// A number is only suspicious next to a word that makes it an economy claim.
const NEAR = /\b(bank|banks|banked|banking|ticket|tickets|debate|debates|save|store)\b/i

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx|ts)$/.test(p)) out.push(p)
  }
  return out
}

const hits = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      const code = line.trim()
      // Comments are documentation, not copy, and the constants file itself is
      // allowed to state its own numbers.
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return
      // An interpolated value is the correct form, so a line already reading
      // the constant is never a hit.
      if (/TICKET_RATES|_BANK_LABEL|_RATE_LABEL|PACK_SIZE/.test(line)) return
      if (!NEAR.test(line)) return
      // Tailwind tokens carry numbers that are not copy ("text-chalk-3",
      // "mt-3", "py-2.5"), and the free cap is 3, so any line naming a ticket
      // and using the chalk-3 colour read as a hand-typed cap. Drop
      // hyphenated utility tokens before looking for a number.
      const copy = line.replace(/[\w:/[\].-]*-\d+(?:\.\d+)?(?![\w.])/g, '')
      for (const { value, what } of NUMBERS) {
        if (new RegExp(`\\b${value}\\b`).test(copy)) {
          hits.push({ file: relative('.', file), line: i + 1, value, what, text: code })
        }
      }
    })
  }
}

if (hits.length) {
  console.error(`Hand-typed economy numbers in copy (${hits.length}):\n`)
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  ${h.value} looks like ${h.what}`)
    console.error(`    ${h.text.slice(0, 110)}`)
  }
  console.error(
    '\nInterpolate from lib/tickets.ts (TICKET_RATES, PRO_BANK_LABEL, FREE_BANK_LABEL)'
  )
  console.error('rather than typing the number, or move the line into a comment.')
  process.exit(1)
}

console.log('Economy copy clean: no hand-typed bank caps in app/ or components/.')
