import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Single root proxy (Next.js 16 convention) — same model as pitchcoachai.
//
// Pre-launch gate: when NEXT_PUBLIC_AUTH_LIVE !== "true" (production today) the
// app is closed. Only the landing page + waitlist are public; /auth/* and
// /dashboard/* redirect back to /. Flip the env var to "true" (dev preview) to
// open the real app, at which point the auth gate below applies:
//   `/`            → anonymous visitors see the landing page; signed-in users
//                    redirect straight to /dashboard.
//   `/auth/*`      → always reachable (login/signup/callback).
//   `/dashboard/*` → requires auth; unauthenticated → /auth/login.
//   `/upgrade`     → same: checkout needs a signed-in user to bill.
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const authLive = process.env.NEXT_PUBLIC_AUTH_LIVE === 'true'

  // Pre-launch: landing-only. Bounce every app route to the landing page.
  if (!authLive) {
    if (
      pathname.startsWith('/dashboard') ||
      pathname.startsWith('/auth') ||
      pathname.startsWith('/upgrade')
    ) {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return NextResponse.next({ request: { headers: request.headers } })
  }

  let response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (pathname === '/') {
    if (!user) return response
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Auth pages stay reachable when the app is live.
  if (pathname.startsWith('/auth')) {
    return response
  }

  // /dashboard/* and /upgrade require auth. The destination rides along as
  // ?next=, so a lobby invite (/dashboard/live?code=...) or a shared verdict's
  // "take the other side" link still works for the friend who has to sign up
  // first. It used to drop the query, which is exactly the person the link was
  // made for. The login page only honours relative same-origin paths.
  if (!user) {
    const login = new URL('/auth/login', request.url)
    login.searchParams.set('next', `${pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(login)
  }

  return response
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/auth/:path*', '/upgrade'],
}
