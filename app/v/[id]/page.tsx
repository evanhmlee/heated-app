import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { fetchVerdictShare } from '@/lib/og'
import { supabaseServer } from '@/lib/supabase-server'
import { cardPath, SHARE_FORMATS } from '@/lib/share'
import { ScoreRing } from '@/components/score-ring'
import ViewBeacon from '@/components/view-beacon'

export const dynamic = 'force-dynamic'

async function originFromHeaders() {
  const h = await headers()
  const host = h.get('host') ?? 'www.getheated.app'
  const proto = host.includes('localhost') ? 'http' : 'https'
  return `${proto}://${host}`
}

// Absolute OG image URL (per-environment) so link unfurls resolve correctly in
// iMessage / Twitter / WhatsApp.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const d = await fetchVerdictShare(id)
  if (!d) {
    return { title: 'Verdict not found · Heated' }
  }

  const origin = await originFromHeaders()
  const bName = d.guestName ?? 'the AI'
  // Sides in the unfurl too, so a pasted link says who argued what.
  const aLabel = d.userSide ? `${d.username} (${d.userSide})` : d.username
  const bLabel = d.guestSide ? `${bName} (${d.guestSide})` : bName
  const winnerText =
    d.winner === 'user'
      ? `${aLabel} beat ${bLabel} ${d.userScore}-${d.aiScore}`
      : d.winner === 'opponent'
        ? `${bLabel} beat ${aLabel} ${d.aiScore}-${d.userScore}`
        : `${aLabel} and ${bLabel} tied ${d.userScore}-${d.aiScore}`
  const title = `${d.topic}: the verdict`
  const description = `${winnerText}. Judged by Heated.`
  const image = `${origin}${cardPath(id, 'og')}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${origin}/v/${id}`,
      images: [{ url: image, ...SHARE_FORMATS.og }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  }
}

export default async function PublicVerdictPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const d = await fetchVerdictShare(id)
  if (!d) notFound()

  const userWon = d.winner === 'user'
  const aiWon = d.winner === 'opponent'
  const bName = d.guestName ?? 'The AI'
  // vs the AI stores no side for the AI itself; "the other side" is the truth.
  const bSide = d.guestSide ?? (d.guestName === null && d.userSide ? 'the other side' : null)
  const result = userWon
    ? `${d.username} beat ${d.guestName ?? 'the AI'}, ${d.userScore} to ${d.aiScore}.`
    : aiWon
      ? `${bName} beat ${d.username}, ${d.aiScore} to ${d.userScore}.`
      : `${d.username} and ${d.guestName ?? 'the AI'} tied at ${d.userScore}.`

  // "Take the other side" (UX audit G2): the friend argues the same topic
  // against the AI. The topic travels as this debate's id and is read back
  // through the same public share read, never as text. Before launch the app
  // is closed, so the button joins the waitlist instead.
  const appOpen = process.env.NEXT_PUBLIC_AUTH_LIVE === 'true'
  const setupPath = `/dashboard/debate/new?from=${id}`
  let signedIn = false
  if (appOpen) {
    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    signedIn = Boolean(user)
  }
  const ctaHref = !appOpen
    ? '/#early-access'
    : signedIn
      ? setupPath
      : `/auth/signup?next=${encodeURIComponent(setupPath)}`

  const seats = [
    { name: d.username, side: d.userSide, score: d.userScore, win: userWon, delay: 0 },
    { name: bName, side: bSide, score: d.aiScore, win: aiWon, delay: 150 },
  ]

  return (
    <div className="relative min-h-dvh bg-ink text-chalk">
      <ViewBeacon debateId={id} hasReceipts={d.receipts.length > 0} />
      <div className="grain" aria-hidden />

      {/* The same small lockup as the app. The old 56px mark and 32px wordmark
          ran into "THE VERDICT" on a phone. */}
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-5">
          <Link href="/" aria-label="Heated home" className="flex shrink-0 items-center gap-1.5">
            <Image src="/logo-mark.png" alt="" width={64} height={64} className="h-8 w-8 -translate-y-0.5" />
            <Image src="/wordmark-red.png" alt="" width={253} height={36} className="h-4 w-auto sm:h-5" />
          </Link>
          <span className="font-mono text-[10px] font-bold tracking-[0.25em] text-chalk-3">THE VERDICT</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        <p className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-blaze-bright">THE TOPIC</p>
        <h1 className="mt-2 font-athletic text-[clamp(1.5rem,5.5vw,2.75rem)] font-black uppercase leading-[1.02] tracking-tight">
          {d.topic}
        </h1>
        <p className="mt-4 text-lg text-chalk">{result}</p>

        <div className="pop-in mt-6 overflow-hidden rounded-card border border-blaze/45 bg-panel">
          <ul className="divide-y divide-line">
            {seats.map((seat) => (
              <li key={seat.name} className="flex items-center gap-4 px-5 py-4 sm:px-7">
                <ScoreRing score={seat.score} win={seat.win} size="sm" delayMs={seat.delay} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-chalk">{seat.name}</p>
                  {seat.side && <p className="text-sm text-chalk-3">argued {seat.side}</p>}
                </div>
                {seat.win && (
                  <span className="bg-blaze px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-white">
                    WINNER
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="border-t border-line px-5 py-6 sm:px-7">
            <p className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-blaze-bright">JUDGE&apos;S NOTE</p>
            <p className="mt-2.5 leading-relaxed text-chalk-2">{d.note}</p>

            {/* The evidence behind the score. Empty when the sharer turned
                receipts off; fetchVerdictShare handles that. */}
            {d.receipts.length > 0 && (
              <ul className="mt-4 space-y-2">
                {d.receipts.map((r, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm leading-relaxed text-chalk-3">
                    <span aria-hidden className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-blaze-bright" />
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Growth loop: turn a shared verdict into a new debater. */}
        <section className="mt-8 rounded-card border border-blaze/35 bg-steel/30 p-6 sm:p-7">
          <h2 className="font-athletic text-2xl font-black uppercase tracking-tight">
            Think you&apos;d argue it better?
          </h2>
          <p className="mt-2 leading-relaxed text-chalk-2">
            {appOpen
              ? 'Take the same topic against the same AI judge. Your first debates are free, no card.'
              : 'Heated opens soon. Join the waitlist and argue this one yourself when it does.'}
          </p>
          <Link
            href={ctaHref}
            className="game-btn clip-blade mt-5 inline-flex min-h-[52px] w-full items-center justify-center px-8 font-mono text-sm font-semibold uppercase tracking-widest text-white sm:w-auto"
          >
            {appOpen ? 'Take the other side' : 'Join the waitlist'}
          </Link>
        </section>

        <div className="mt-8 flex items-start gap-3">
          <Image src="/logo-mark.png" alt="" width={64} height={64} className="h-7 w-7 shrink-0" />
          <p className="text-sm leading-relaxed text-chalk-3">
            Heated is a basketball debate app. You argue against the AI or a friend, and an AI judge
            scores it on facts, logic and delivery, checking the stats you name.
          </p>
        </div>
      </main>

      <footer className="border-t border-line px-5 py-8">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 text-[13px] text-chalk-3">
          <span>© 2026 Heated</span>
          <span>Not affiliated with the NBA.</span>
        </div>
      </footer>
    </div>
  )
}
