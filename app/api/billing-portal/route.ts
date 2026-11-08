import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'
import { getStripe } from '@/lib/stripe'

// Stripe's hosted billing portal: change card, switch plan, cancel. Building
// any of that ourselves is a lifecycle surface that breaks at 11pm on launch
// night, and Stripe's version is free.
export async function POST(req: NextRequest) {
  try {
    const stripe = getStripe()
    const supabase = await supabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: profile } = await supabaseAdmin()
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (!profile?.stripe_customer_id) {
      // Never paid for anything, so there is no billing to manage.
      return NextResponse.json({ error: 'no_customer' }, { status: 404 })
    }

    const origin = req.headers.get('origin') || 'http://localhost:3000'
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/dashboard`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'portal failed'
    console.error('[billing-portal]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
