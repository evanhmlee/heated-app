import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase-server'
import type { Verdict } from '@/lib/debate'

// Fonts for next/og image rendering. Read from public/fonts (deployed to the
// serverless filesystem) once, then cached in module scope. Anton = display,
// Archivo = body. Static TTF only — satori crashes on variable fonts and can't
// read woff2.
let fontCache: { anton: Buffer; archivo: Buffer; archivoSemibold: Buffer } | null = null
export async function loadOgFonts() {
  if (fontCache) return fontCache
  const dir = join(process.cwd(), 'public', 'fonts')
  const [anton, archivo, archivoSemibold] = await Promise.all([
    readFile(join(dir, 'Anton-Regular.ttf')),
    readFile(join(dir, 'Archivo-Regular.ttf')),
    readFile(join(dir, 'Archivo-SemiBold.ttf')),
  ])
  fontCache = { anton, archivo, archivoSemibold }
  return fontCache
}

// Brand marks for the share card, inlined as data URIs. Satori will not fetch a
// relative URL (it has no origin) and a remote fetch on every render is a cold
// start nobody needs, so both marks are read off the deployed filesystem once
// and cached in module scope next to the fonts.
//
// The 64px mark and not logo-mark.png: the full-size one is 1024x1024 and 350KB,
// which is 470KB of base64 embedded into every single card render for something
// that draws at 40-64px.
let logoCache: { mark: string; wordmark: string } | null = null
export async function loadOgLogos() {
  if (logoCache) return logoCache
  const dir = join(process.cwd(), 'public')
  const [mark, wordmark] = await Promise.all([
    readFile(join(dir, 'logo-mark-64.png')),
    readFile(join(dir, 'wordmark-white.png')),
  ])
  logoCache = {
    mark: `data:image/png;base64,${mark.toString('base64')}`,
    wordmark: `data:image/png;base64,${wordmark.toString('base64')}`,
  }
  return logoCache
}

export const ANON_NAME = 'A baller'

export type VerdictShare = {
  id: string
  /** Display name, already gated by share_name. Never the raw username when hidden. */
  username: string
  /** False when the sharer chose to post anonymously. */
  named: boolean
  topic: string
  userSide: string | null
  userScore: number
  aiScore: number
  winner: 'user' | 'opponent' | 'none'
  note: string
  /** The judge's evidence. Empty when the sharer turned receipts off. */
  receipts: string[]
  // Human vs Human exhibitions: the named friend on the B side of the card.
  // null = a vs-AI debate (the B side renders as THE AI).
  guestName: string | null
  /** What the B side argued, for H2H. null vs the AI, which stores no side for itself. */
  guestSide: string | null
}

// Public share read. Uses the service role because debates are RLS-scoped to
// their owner and anon SELECT is revoked — a share link/crawler has no session.
// Only returns COMPLETE debates, and only the fields safe to make public (the
// matchup, scores, and judge note; never private account data). The debate UUID
// is the access token: unguessable, and only handed out when the user shares.
//
// share_revoked is the way back out: the sharer took the verdict down, so this
// returns null and every public surface 404s. Checked here rather than at each
// call site so the page and the card can never disagree about what is live.
export async function fetchVerdictShare(id: string): Promise<VerdictShare | null> {
  // Reject anything that isn't a UUID before hitting the DB.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null

  const admin = supabaseAdmin()
  const { data: debate } = await admin
    .from('debates')
    .select('id, topic_text, user_side, status, verdict, user_score, opponent_score, winner, user_id, opponent, versus, share_revoked, share_receipts, share_name')
    .eq('id', id)
    .single()
  if (!debate || debate.status !== 'complete' || !debate.verdict) return null
  if (debate.share_revoked) return null

  const named = debate.share_name !== false

  // debates.user_id references auth.users, not profiles, so no PostgREST join;
  // fetch the username separately. Skipped entirely when the sharer went
  // anonymous: no reason to read a name we are not allowed to print.
  const prof = named
    ? (
        await admin
          .from('profiles')
          .select('username')
          .eq('id', debate.user_id)
          .single()
      ).data
    : null

  const verdict = debate.verdict as Verdict
  const versus = (debate.versus ?? null) as { guest_name?: string; guest_side?: string } | null
  return {
    id: debate.id,
    username: named ? (prof?.username ?? ANON_NAME) : ANON_NAME,
    named,
    topic: debate.topic_text,
    userSide: debate.user_side,
    userScore: debate.user_score ?? verdict.user_score,
    aiScore: debate.opponent_score ?? verdict.ai_score,
    winner: (debate.winner as VerdictShare['winner']) ?? verdict.winner,
    note: verdict.note ?? '',
    receipts:
      debate.share_receipts !== false && Array.isArray(verdict.receipts)
        ? verdict.receipts.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        : [],
    guestName:
      debate.opponent === 'human' ? versus?.guest_name?.trim() || 'The Challenger' : null,
    guestSide: debate.opponent === 'human' ? versus?.guest_side?.trim() || null : null,
  }
}
