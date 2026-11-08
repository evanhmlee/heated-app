import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'
import {
  PACK,
  PLANS,
  getStripe,
  priceIdFor,
  resolveFoundingDiscount,
  type PlanKey,
} from '@/lib/stripe'

// Opens a Stripe Checkout session. Two shapes:
//   { plan: 'weekly' | 'monthly' }  → Pro subscription
//   { pack: true }                  → one-time 10-debate pack
//
// Nothing about price comes from the client. The plan key selects a lookup key
// and the pack amount is a server constant, so a tampered body can at worst pick
// the other plan, never set its own price.
export async function POST(req: NextRequest) {
  try {
    const stripe = getStripe()
    const body = await req.json().catch(() => ({}))
    const wantsPack = body?.pack === true
    const plan = body?.plan as PlanKey | undefined

    if (!wantsPack && (!plan || !(plan in PLANS))) {
      return NextResponse.json({ error: 'Unknown plan' }, { status: 400 })
    }

    const supabase = await supabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const admin = supabaseAdmin()
    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_customer_id, username, is_founding, is_pro')
      .eq('id', user.id)
      .single()

    if (!wantsPack && profile?.is_pro) {
      // Already subscribed: a second checkout would open a second subscription
      // and bill them twice. Send them to the portal instead.
      return NextResponse.json({ error: 'already_pro' }, { status: 409 })
    }

    let customerId = profile?.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: profile?.username ?? undefined,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id
      // Billing columns are absent from the authenticated UPDATE grant, so this
      // write has to go through the service role.
      await admin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id)
    }

    const origin = req.headers.get('origin') || 'http://localhost:3000'
    const kind: PlanKey | 'pack' = wantsPack ? 'pack' : (plan as PlanKey)
    const founding = await resolveFoundingDiscount(
      stripe,
      Boolean(profile?.is_founding),
      kind
    )

    // A founder whose discount cannot be applied is stopped here rather than
    // sent to a full-price checkout. Being overcharged after being promised
    // "30% off everything, forever" is worse than a failed checkout, and the
    // old fall-through was silent: nothing logged and nothing alerted, so the
    // first signal would have been a founder asking for a refund.
    if (founding.kind === 'broken') {
      console.error(
        '[checkout] founding discount unavailable',
        JSON.stringify({ user: user.id, sku: kind, reason: founding.reason })
      )
      return NextResponse.json(
        { error: 'founding_discount_unavailable' },
        { status: 503 }
      )
    }

    // Stripe rejects a session that sets both `discounts` and
    // `allow_promotion_codes`. A founder already has their discount attached, so
    // the code box is only offered to everyone else.
    const discountFields =
      founding.kind === 'discount'
        ? { discounts: founding.discounts }
        : { allow_promotion_codes: true }

    if (wantsPack) {
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: PACK.amountCents,
              product_data: { name: `Heated: ${PACK.label}` },
            },
            quantity: 1,
          },
        ],
        success_url: `${origin}/dashboard?pack=success`,
        cancel_url: `${origin}/upgrade?view=pack`,
        ...discountFields,
        metadata: {
          supabase_user_id: user.id,
          type: 'pack',
          tickets: String(PACK.tickets),
        },
      })
      return NextResponse.json({ url: session.url })
    }

    // Narrowed here rather than at the guard: TS cannot carry the `plan in
    // PLANS` check through the intervening awaits.
    const planKey = plan as PlanKey
    const priceId = await priceIdFor(stripe, PLANS[planKey].lookupKey)
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard?upgraded=true`,
      cancel_url: `${origin}/upgrade`,
      ...discountFields,
      metadata: { supabase_user_id: user.id, type: 'subscription', plan: planKey },
      // Mirrored onto the subscription so the later subscription.updated /
      // .deleted events can find the user without a customer lookup.
      subscription_data: {
        metadata: { supabase_user_id: user.id, plan: planKey },
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'checkout failed'
    console.error('[checkout]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
