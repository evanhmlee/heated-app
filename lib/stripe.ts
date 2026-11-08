import Stripe from 'stripe'
import { PRO_PRICE_LABEL, PRO_WEEKLY_PRICE_LABEL } from '@/lib/tickets'

// Stripe plumbing, server-only.
//
// NEVER instantiate Stripe at module scope. `new Stripe(undefined)` throws, and
// Next collects page data at build time, so a module-level client crashes the
// Vercel build rather than failing at request time. Every entry point here
// builds the client per-call.
//
// Prices are resolved by LOOKUP KEY, not by hardcoded price id. Stripe prices
// are immutable, so any future price change means creating a new price object;
// PitchCoach hardcodes four price literals and branches on NODE_ENV to pick
// between test and live, and that pattern breaks the first time a v2 exists.
// A lookup key survives the swap: point the key at the new price in Stripe and
// this code needs no deploy. It also means test and live mode share one code
// path, because the key is the same in both.

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  return new Stripe(key)
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export type PlanKey = 'weekly' | 'monthly'

// Pro, weekly or monthly (founder call 2026-10-11: weekly replaced annual,
// because most people play around a season, a playoff run or one argument, not
// a year). Same three tickets a day on both. The display prices come from
// lib/tickets.ts, the one place every client surface reads them; the AMOUNTS
// live on the Stripe prices, found by lookup key and created by
// scripts/stripe-setup.mjs.
export const PLANS: Record<
  PlanKey,
  { lookupKey: string; label: string; price: string; period: string; note: string }
> = {
  weekly: {
    lookupKey: 'heated_pro_weekly',
    label: 'Weekly',
    price: PRO_WEEKLY_PRICE_LABEL,
    period: 'per week',
    note: 'Renews every week until you cancel.',
  },
  monthly: {
    lookupKey: 'heated_pro_monthly',
    label: 'Monthly',
    price: PRO_PRICE_LABEL,
    period: 'per month',
    note: 'Renews every month until you cancel.',
  },
}

// The pack: 10 debates, one payment, no subscription. Sold with inline
// price_data rather than a catalogue price because there is exactly one pack
// SKU and a dashboard object would be a second place to keep it in sync.
export const PACK = {
  tickets: 10,
  amountCents: 199,
  label: '10 debates',
}

// Founding: 30% off, forever, first 100 subscribers. Created by
// scripts/stripe-setup.mjs; the id lands in this env var.
//
// Applied automatically for anyone whose profile carries is_founding (the first
// 100 accounts, flagged at signup by handle_new_user), so a founder never has to
// type a code they were never given.
//
// EVERYTHING: weekly, monthly and the pack (founder decision 2026-08-10, kept
// when weekly replaced annual on 2026-10-11). The landing promises "30% off
// everything, forever", and a founder billed full price on any of them has
// been told one thing and charged another. Founding weekly is $2.09, monthly
// $4.89, the pack $1.39.
export const FOUNDING_APPLIES: readonly (PlanKey | 'pack')[] = [
  'weekly',
  'monthly',
  'pack',
]

export function foundingCouponId(): string | null {
  return process.env.STRIPE_FOUNDING_COUPON_ID || null
}

export type FoundingDiscount =
  | { kind: 'none' }
  | { kind: 'discount'; discounts: { coupon: string }[] }
  | { kind: 'broken'; reason: string }

/**
 * Resolve the founding discount against Stripe rather than assuming it works.
 *
 * The promise on the landing page and the pinned carousel is "30% off
 * everything, forever". Two things quietly break that:
 *
 *   1. STRIPE_FOUNDING_COUPON_ID unset in an environment. foundingCouponId()
 *      returns null and the previous code fell straight through to a plain
 *      promo-code box, so the founder paid full price and nothing errored.
 *   2. The coupon stops being valid. A coupon carrying max_redemptions counts
 *      REDEMPTIONS, not people: a subscription consumes one when the discount
 *      is attached, but every one-time pack purchase consumes another. A few
 *      repeat pack buyers can therefore exhaust a 100-redemption coupon while
 *      most of the 100 founders have never used it once.
 *
 * In both cases the caller IS a founder who must not be billed full price, so
 * this returns 'broken' and the route stops. A blocked checkout is a support
 * ticket you hear about; a silently overcharged founder is a refund, a broken
 * promise, and nothing in the system would have flagged it.
 */
export async function resolveFoundingDiscount(
  stripe: Stripe,
  isFounding: boolean,
  kind: PlanKey | 'pack'
): Promise<FoundingDiscount> {
  if (!isFounding || !FOUNDING_APPLIES.includes(kind)) return { kind: 'none' }

  const id = foundingCouponId()
  if (!id) return { kind: 'broken', reason: 'STRIPE_FOUNDING_COUPON_ID is not set' }

  try {
    const coupon = await stripe.coupons.retrieve(id)
    if (!coupon.valid) {
      const cap = coupon.max_redemptions ? ' of ' + coupon.max_redemptions : ''
      return {
        kind: 'broken',
        reason:
          'coupon ' + id + ' is no longer valid (redeemed ' + coupon.times_redeemed + cap + ')',
      }
    }
    return { kind: 'discount', discounts: [{ coupon: id }] }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return { kind: 'broken', reason: 'coupon ' + id + ' could not be retrieved: ' + message }
  }
}

/**
 * Look up a live price id by its lookup key. Throws a legible error rather than
 * letting checkout fail with a Stripe "no such price", because the only way this
 * happens is that scripts/stripe-setup.mjs has not been run in this mode.
 */
export async function priceIdFor(stripe: Stripe, lookupKey: string): Promise<string> {
  const { data } = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  })
  const price = data[0]
  if (!price) {
    throw new Error(
      `No active Stripe price with lookup_key "${lookupKey}". Run scripts/stripe-setup.mjs against this Stripe mode.`
    )
  }
  return price.id
}
