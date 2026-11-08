#!/usr/bin/env node
/**
 * One-time (idempotent) Stripe setup for Heated.
 *
 * Creates the product, the two Pro prices keyed by lookup_key, and the founding
 * coupon + public promotion code. Safe to re-run: it looks for existing objects
 * by lookup key / coupon id first and only creates what is missing.
 *
 * Run it once per Stripe MODE. Test and live are separate object graphs, and
 * the app resolves prices by lookup key, so the same keys must exist in both.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-setup.mjs
 *
 * Then put the printed STRIPE_FOUNDING_COUPON_ID into .env.local and Vercel.
 *
 * Prices here MUST match the labels in lib/tickets.ts (read by the landing,
 * /upgrade and the in-app Pro cards):
 *   Pro weekly  $2.99   Pro monthly  $6.99   Founding  30% off, forever, 100 max
 *
 * Weekly replaced annual on 2026-10-11. The old annual price
 * (heated_pro_annual, $49.99) is no longer created or sold; archive it in the
 * Stripe dashboard if it exists. The webhook does not care about the interval,
 * so an annual subscription made before then keeps working.
 * The $1.99 pack is NOT created here: it is sold with inline price_data from
 * app/api/checkout/route.ts, so there is no catalogue object to keep in sync.
 */

import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error('STRIPE_SECRET_KEY is required.')
  process.exit(1)
}

const stripe = new Stripe(key)
const mode = /^(sk|rk)_live_/.test(key) ? 'LIVE' : 'TEST'
console.log(`\nHeated Stripe setup — ${mode} mode\n`)

const PRODUCT_NAME = 'Heated Pro'
// Keep in step with PRO_DEBATES_PER_DAY in lib/tickets.ts.
const PRODUCT_DESCRIPTION = "Three debates a day, custom topics, and the judge's full reasoning."
const PRICES = [
  { lookupKey: 'heated_pro_weekly', amount: 299, interval: 'week', nickname: 'Pro weekly' },
  { lookupKey: 'heated_pro_monthly', amount: 699, interval: 'month', nickname: 'Pro monthly' },
]
const COUPON_ID = 'heated_founding_30'
const PROMO_CODE = 'FOUNDING100'

async function findOrCreateProduct() {
  const { data } = await stripe.products.search({
    query: `name:'${PRODUCT_NAME}' AND active:'true'`,
    limit: 1,
  })
  if (data[0]) {
    // Stripe shows this line on the checkout page, so an existing product with
    // stale copy (it said "Five debates a day" until Pro went to three on
    // 2026-10-12) is corrected rather than left alone.
    if (data[0].description !== PRODUCT_DESCRIPTION) {
      await stripe.products.update(data[0].id, { description: PRODUCT_DESCRIPTION })
      console.log(`product      ~ updated description on ${data[0].id}`)
    } else {
      console.log(`product      ✓ exists  ${data[0].id}`)
    }
    return data[0]
  }
  const product = await stripe.products.create({
    name: PRODUCT_NAME,
    description: PRODUCT_DESCRIPTION,
  })
  console.log(`product      + created ${product.id}`)
  return product
}

async function findOrCreatePrice(product, spec) {
  const { data } = await stripe.prices.list({
    lookup_keys: [spec.lookupKey],
    active: true,
    limit: 1,
  })
  if (data[0]) {
    console.log(`${spec.lookupKey.padEnd(21)} ✓ exists  ${data[0].id} (${data[0].unit_amount / 100})`)
    return data[0]
  }
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: spec.amount,
    recurring: { interval: spec.interval },
    lookup_key: spec.lookupKey,
    nickname: spec.nickname,
  })
  console.log(`${spec.lookupKey.padEnd(21)} + created ${price.id} (${spec.amount / 100})`)
  return price
}

async function findOrCreateCoupon() {
  try {
    const existing = await stripe.coupons.retrieve(COUPON_ID)
    console.log(`coupon       ✓ exists  ${existing.id} (${existing.percent_off}% ${existing.duration})`)
    return existing
  } catch {
    // Not found; fall through and create it.
  }
  // duration: 'forever' is the point. A discount that expires is legible; a
  // price that goes up later reads as a betrayal, and the landing page promises
  // "30% off everything, forever".
  const coupon = await stripe.coupons.create({
    id: COUPON_ID,
    percent_off: 30,
    duration: 'forever',
    max_redemptions: 100,
    name: 'Founding member',
  })
  console.log(`coupon       + created ${coupon.id} (30% forever, max 100)`)
  return coupon
}

async function findOrCreatePromoCode(coupon) {
  const { data } = await stripe.promotionCodes.list({ code: PROMO_CODE, active: true, limit: 1 })
  if (data[0]) {
    // A code is unique per Stripe ACCOUNT, not per product. PitchCoach also
    // launched with a public FOUNDING100 (its own 50%-off coupon), so in a
    // shared account "it exists" is not "it is ours": Heated's checkout would
    // honor PitchCoach's coupon and this script would have called that fine.
    const p = data[0]
    const linked =
      p.coupon?.id ?? (typeof p.promotion?.coupon === 'string' ? p.promotion.coupon : p.promotion?.coupon?.id)
    if (linked !== coupon.id) {
      console.error(
        `promo code   ✗ ${PROMO_CODE} is already live in this account on coupon ${linked}, not ${coupon.id}.\n` +
          `               Deactivate that code in the dashboard (or pick another code here) and re-run.`
      )
      process.exitCode = 1
      return p
    }
    console.log(`promo code   ✓ exists  ${p.code}`)
    return p
  }
  // On recent API versions a promotion code takes promotion[type]/promotion[coupon]
  // rather than a bare `coupon` param; the API rejects `coupon` outright
  // ("Received unknown parameter: coupon", 2026-07-29.dahlia).
  const promo = await stripe.promotionCodes.create({
    promotion: { type: 'coupon', coupon: coupon.id },
    code: PROMO_CODE,
    max_redemptions: 100,
  })
  console.log(`promo code   + created ${promo.code}`)
  return promo
}

const product = await findOrCreateProduct()
for (const spec of PRICES) await findOrCreatePrice(product, spec)
const coupon = await findOrCreateCoupon()
await findOrCreatePromoCode(coupon)

console.log(`
Done. Set this in .env.local and in Vercel (${mode}):

  STRIPE_FOUNDING_COUPON_ID=${COUPON_ID}

The founding discount is attached automatically for accounts flagged
is_founding, so the ${PROMO_CODE} code is only for anyone outside the first 100
you want to hand it to.
`)
