import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { PostHog } from 'posthog-node'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getStripe } from '@/lib/stripe'
import { EVENTS, posthogKey } from '@/lib/analytics'

// Stripe's side of the till. Ported from pitchcoachai with one real change:
// a pack grants tickets through add_purchased_tickets() and must NEVER touch
// is_pro, because pack buyers are not subscribers. They get the Pro *perks*
// while their tickets last, which is decided by is_effective_pro() reading
// purchased_tickets, not by a flag this route writes.

// Per-request, like Stripe: the build must not require the key.
function getPostHog() {
  // Same committed fallback as the browser: Vercel will not save the env var,
  // and without it subscription_started would never reach PostHog.
  const key = posthogKey()
  if (!key) return null
  return new PostHog(key, { host: 'https://us.i.posthog.com' })
}

async function track(
  userId: string,
  event: string,
  properties: Record<string, unknown>
) {
  const posthog = getPostHog()
  if (!posthog) return
  posthog.capture({ distinctId: userId, event, properties })
  // Serverless: the function can be frozen the instant the response is sent,
  // so the queue has to be flushed before returning.
  await posthog.shutdown()
}

export async function POST(req: NextRequest) {
  const stripe = getStripe()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'not configured' }, { status: 500 })
  }

  const body = await req.text()
  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad signature'
    console.error('[webhook] invalid signature:', message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = supabaseAdmin()

  try {
    // Idempotency. Stripe delivers at least once, and a retry of a pack purchase
    // would mint a second pack of tickets. The row is CHECKED here but only
    // WRITTEN after processing succeeds (bottom of this block): if the work
    // throws, no row exists, so Stripe's retry is treated as a fresh delivery
    // rather than swallowed as a duplicate that never actually happened.
    const { data: already } = await supabase
      .from('processed_stripe_events')
      .select('event_id')
      .eq('event_id', event.id)
      .maybeSingle()
    if (already) {
      return NextResponse.json({ received: true, duplicate: true })
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.supabase_user_id
        if (!userId) break

        // One-time pack. Adds tickets, never touches is_pro.
        if (session.mode === 'payment' || session.metadata?.type === 'pack') {
          const tickets = parseInt(session.metadata?.tickets ?? '0', 10)
          if (tickets > 0) {
            const { error } = await supabase.rpc('add_purchased_tickets', {
              p_user: userId,
              p_qty: tickets,
            })
            // Throw rather than swallow: an unrecorded event means Stripe
            // retries, which is exactly what should happen when someone paid
            // and did not get their tickets.
            if (error) throw new Error(`add_purchased_tickets: ${error.message}`)
          }
          await track(userId, EVENTS.PACK_PURCHASED, {
            tickets,
            amount_total: session.amount_total,
            currency: session.currency,
          })
          break
        }

        await supabase
          .from('profiles')
          .update({
            is_pro: true,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
          })
          .eq('id', userId)

        await track(userId, EVENTS.SUBSCRIPTION_STARTED, {
          plan: session.metadata?.plan,
          amount_total: session.amount_total,
          currency: session.currency,
        })
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.supabase_user_id
        if (!userId) break
        // 'past_due' means a renewal failed but Stripe's smart retries are still
        // collecting, often over several days. Revoking Pro on the first decline
        // churns subscribers who would have paid on retry, so only a terminal
        // status flips the flag.
        if (['active', 'trialing'].includes(sub.status)) {
          await supabase.from('profiles').update({ is_pro: true }).eq('id', userId)
        } else if (['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) {
          await supabase.from('profiles').update({ is_pro: false }).eq('id', userId)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.supabase_user_id
        if (!userId) break
        // Tickets are deliberately NOT clawed back. A lapsed subscriber drops to
        // the free accrual rate, which is punishment enough; taking away debates
        // they already banked is how you get a chargeback.
        await supabase
          .from('profiles')
          .update({ is_pro: false, stripe_subscription_id: null })
          .eq('id', userId)
        break
      }
    }

    // Processing succeeded, so record the id. A 23505 means a concurrent
    // delivery of the same event won the race; both did the same work.
    const { error: dedupeError } = await supabase
      .from('processed_stripe_events')
      .insert({ event_id: event.id })
    if (dedupeError && dedupeError.code !== '23505') {
      console.error('[webhook] dedupe insert failed:', dedupeError.message)
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'webhook failed'
    console.error('[webhook error]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
