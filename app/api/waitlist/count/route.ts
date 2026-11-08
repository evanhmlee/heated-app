import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

// Waitlist size for the founder counter on the landing page. The count is
// public by design (it renders on the page), but the rows never leave the
// server: this returns a single number via the service role, so the
// no-anon-read RLS on public.waitlist stays intact.
//
// Cached at the CDN for 60s (s-maxage): the landing fetch rides the cache,
// while the post-signup fetch cache-busts with a query param to get the
// visitor's real spot number.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { count, error } = await supabaseAdmin()
      .from('waitlist')
      .select('*', { count: 'exact', head: true })

    if (error || count === null) {
      return NextResponse.json({ count: null }, { status: 500 })
    }

    return NextResponse.json(
      { count },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    )
  } catch {
    return NextResponse.json({ count: null }, { status: 500 })
  }
}
