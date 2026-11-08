'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { Check } from '@phosphor-icons/react/dist/ssr'
import { supabaseBrowser } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { EVENTS, capture } from '@/lib/analytics'
import {
  PACK_FOUNDING_PRICE_LABEL,
  PACK_PRICE_LABEL,
  PACK_SIZE,
  PRO_FOUNDING_PRICE_LABEL,
  PRO_PRICE_LABEL,
  PRO_WEEKLY_FOUNDING_PRICE_LABEL,
  PRO_WEEKLY_PRICE_LABEL,
  TICKET_RATES,
  PRO_DEBATES_PER_DAY,
} from '@/lib/tickets'
// The single swap point, shared with the legal pages' mailto: links.
import { CONTACT_EMAIL } from '@/components/legal'

// The paywall (UX audit F, 2026-10-10), reached from the Pro cards, the ticket
// meter, the cap card and the landing's Go Pro CTA.
//
// Pro leads. On a phone this page used to open on the Free card, the plan the
// reader already has, with Pro below the fold, and Pro's button was a
// near-black slab on a dark card: the weakest button on the paywall, while the
// pack's red one was the strongest. Pro now gets the red button and a plain
// line under it saying what it renews at. Free is one line at the bottom.
//
// The pack still comes FIRST when the cap card sends people here
// (?view=pack): there the impulse buy is the honest offer, which is what the
// council's outsider persona argued in August.
//
// Weekly and monthly (founder call 2026-10-11, weekly replaced annual), the
// same three tickets a day on both. Every price shown comes from lib/tickets.ts.

const PRO_PERKS = [
  { text: `${PRO_DEBATES_PER_DAY} debates a day`, aside: '(Free: 1 a week)' },
  { text: "The judge's Deep Dive on every debate, old ones too" },
  { text: 'Bring your own topic' },
  { text: `Bank up to ${TICKET_RATES.pro.bankCap} tickets` },
]

type Billing = 'weekly' | 'monthly'

const BILLING: Record<Billing, { label: string; price: string; founding: string; unit: string }> = {
  weekly: {
    label: 'Weekly',
    price: PRO_WEEKLY_PRICE_LABEL,
    founding: PRO_WEEKLY_FOUNDING_PRICE_LABEL,
    unit: 'week',
  },
  monthly: {
    label: 'Monthly',
    price: PRO_PRICE_LABEL,
    founding: PRO_FOUNDING_PRICE_LABEL,
    unit: 'month',
  },
}

function UpgradeInner() {
  const params = useSearchParams()
  // Weekly is the default (founder call 2026-10-12). ?period=monthly is the
  // period picked on the landing's Pro card, carried through signup so
  // checkout opens on the plan they chose.
  const [billing, setBilling] = useState<Billing>(
    params.get('period') === 'monthly' ? 'monthly' : 'weekly'
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isFounding, setIsFounding] = useState(false)
  const [isPro, setIsPro] = useState(false)
  // Prices stay hidden (space kept) until the account is read, so a founder
  // never sees the full price flash before their own.
  const [loaded, setLoaded] = useState(false)

  const packFirst = params.get('view') === 'pack'

  useEffect(() => {
    void (async () => {
      const supabase = supabaseBrowser()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('is_founding, is_pro')
          .eq('id', user.id)
          .single()
        setIsFounding(Boolean(prof?.is_founding))
        setIsPro(Boolean(prof?.is_pro))
      }
      setLoaded(true)
    })()
  }, [])

  async function checkout(body: Record<string, unknown>, key: string) {
    setBusy(key)
    setError('')
    capture(EVENTS.CHECKOUT_STARTED, { ...body, founding: isFounding })
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (data?.error === 'already_pro') {
        setError('You are already on Pro. Use Manage billing to change or cancel it.')
        setBusy(null)
        return
      }
      if (data?.error === 'founding_discount_unavailable') {
        // Blocked on purpose so a founder is never charged full price.
        // Retrying cannot clear it.
        setError(
          `Your founder discount is not applying right now, so we stopped the checkout rather than charge you full price. Email ${CONTACT_EMAIL} and we will sort it.`
        )
        setBusy(null)
        return
      }
      if (!res.ok || !data?.url) {
        setError('Could not open checkout. Try again in a sec.')
        setBusy(null)
        return
      }
      window.location.href = data.url
    } catch {
      setError('Could not reach the server. Try again.')
      setBusy(null)
    }
  }

  async function openPortal() {
    setBusy('portal')
    const res = await fetch('/api/billing-portal', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (data?.url) {
      window.location.href = data.url
      return
    }
    setError('Could not open billing. Try again in a sec.')
    setBusy(null)
  }

  const plan = BILLING[billing]
  const charged = isFounding ? plan.founding : plan.price

  const proCard = (
    <section
      aria-labelledby="pro-heading"
      className="flex h-full flex-col rounded-card border border-blaze/50 bg-panel p-6 md:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="pro-heading" className="flex items-center gap-3 font-athletic text-3xl font-black uppercase tracking-tight">
          Pro
          {isPro && (
            <span className="rounded-full border border-blaze/50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-blaze-bright">
              Your plan
            </span>
          )}
        </h2>
        <div
          role="group"
          aria-label="Billing period"
          className="flex gap-1 rounded-card border border-line bg-ink/40 p-1"
        >
          {(Object.keys(BILLING) as Billing[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setBilling(key)}
              aria-pressed={billing === key}
              className={`inline-flex min-h-[40px] items-center rounded-[11px] px-4 text-sm font-semibold transition-colors ${
                billing === key ? 'bg-steel text-chalk ring-1 ring-blaze' : 'text-chalk-3 hover:text-chalk'
              }`}
            >
              {BILLING[key].label}
            </button>
          ))}
        </div>
      </div>

      <div className={`mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 ${loaded ? '' : 'invisible'}`}>
        <p className="font-athletic text-5xl font-black leading-none tabular-nums">{charged}</p>
        <p className="text-sm text-chalk-3">a {plan.unit}</p>
        {isFounding && <p className="text-sm text-chalk-3 line-through">{plan.price}</p>}
      </div>
      {isFounding && (
        <p className="mt-3 inline-flex w-fit items-center rounded-full border border-blaze/50 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-blaze-bright">
          Founder price, forever
        </p>
      )}

      <ul className="mt-6 flex-1 space-y-3 border-t border-line pt-5">
        {PRO_PERKS.map((perk) => (
          <li key={perk.text} className="flex items-start gap-3 text-[15px] leading-snug text-chalk">
            <Check size={16} weight="bold" aria-hidden className="mt-0.5 shrink-0 text-blaze-bright" />
            <span>
              {perk.text}
              {perk.aside && <span className="text-chalk-3"> {perk.aside}</span>}
            </span>
          </li>
        ))}
      </ul>

      {isPro ? (
        <Button
          variant="secondary"
          size="lg"
          className="mt-6 w-full"
          disabled={busy !== null}
          onClick={openPortal}
        >
          {busy === 'portal' ? 'OPENING…' : 'MANAGE OR CANCEL'}
        </Button>
      ) : (
        <>
          <Button
            size="lg"
            className="mt-6 w-full"
            disabled={busy !== null}
            onClick={() => checkout({ plan: billing }, billing)}
          >
            {busy === billing ? 'OPENING…' : 'GO PRO'}
          </Button>
          <p className={`mt-3 text-center text-[13px] leading-relaxed text-chalk-3 ${loaded ? '' : 'invisible'}`}>
            Renews at {charged} a {plan.unit} until you cancel. Cancel any time from your account
            menu.
          </p>
        </>
      )}
    </section>
  )

  const packCard = (
    <section
      aria-labelledby="pack-heading"
      className={`flex h-full flex-col rounded-card border p-6 md:p-8 ${
        packFirst ? 'border-blaze/50 bg-panel' : 'border-line bg-panel'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="pack-heading" className="text-xl font-bold text-chalk">
          Just need a few?
        </h2>
        <p className={`flex items-baseline gap-2 ${loaded ? '' : 'invisible'}`}>
          {isFounding && <span className="text-sm text-chalk-3 line-through">{PACK_PRICE_LABEL}</span>}
          <span className="font-athletic text-3xl font-black leading-none tabular-nums text-blaze-bright">
            {isFounding ? PACK_FOUNDING_PRICE_LABEL : PACK_PRICE_LABEL}
          </span>
        </p>
      </div>
      <p className="mt-3 flex-1 leading-relaxed text-chalk-2">
        {PACK_SIZE} tickets, one payment, no subscription. They never expire, and Pro is turned on
        for as long as they last.
      </p>
      <Button
        variant={packFirst ? 'primary' : 'secondary'}
        size="lg"
        className="mt-6 w-full"
        disabled={busy !== null}
        onClick={() => checkout({ pack: true }, 'pack')}
      >
        {busy === 'pack' ? 'OPENING…' : `BUY ${PACK_SIZE} TICKETS`}
      </Button>
    </section>
  )

  return (
    <div className="relative min-h-dvh bg-ink text-chalk">
      <div className="grain" aria-hidden />

      {/* The app's small lockup. The old 56px mark and 32px wordmark ran
          into BACK on a phone. */}
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-5">
          <Link href="/dashboard" aria-label="Heated, locker room" className="flex shrink-0 items-center gap-1.5">
            <Image src="/logo-mark.png" alt="" width={64} height={64} className="h-8 w-8 -translate-y-0.5" />
            <Image src="/wordmark-red.png" alt="" width={253} height={36} className="h-4 w-auto sm:h-5" />
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex min-h-[44px] items-center px-1 text-sm font-semibold text-chalk-2 hover:text-chalk"
          >
            Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-10 md:py-14">
        <p className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-blaze-bright">MORE TICKETS</p>
        <h1 className="mt-3 font-athletic text-[clamp(2.25rem,7vw,4rem)] font-black uppercase leading-[0.92] tracking-tight">
          Keep arguing.
        </h1>
        <p className="mt-3 max-w-lg leading-relaxed text-chalk-2">
          Free gets one debate a week. Here&apos;s how to get more.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-card border border-blaze/50 bg-panel px-5 py-4 text-sm leading-relaxed text-chalk"
          >
            {error}
          </p>
        )}

        <div className="mt-8 grid gap-4 md:grid-cols-5">
          <div className={packFirst ? 'md:order-2 md:col-span-3' : 'md:col-span-3'}>{proCard}</div>
          <div className={packFirst ? 'order-first md:order-1 md:col-span-2' : 'md:col-span-2'}>{packCard}</div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="text-sm text-chalk-3">
            <span className="font-semibold text-chalk-2">Free</span> · 1 debate a week, banks up to{' '}
            {TICKET_RATES.free.bankCap}, the Daily every day.
          </p>
          {!isPro && (
            <span className="rounded-full border border-line-strong px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-chalk-3">
              Your plan
            </span>
          )}
        </div>
        <p className="mt-4 text-sm text-chalk-3">Payments run through Stripe. We never see your card.</p>
      </main>
    </div>
  )
}

export default function UpgradePage() {
  // useSearchParams needs a Suspense boundary or it de-opts the route to
  // client-side rendering.
  return (
    <Suspense fallback={null}>
      <UpgradeInner />
    </Suspense>
  )
}
