import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import AppHeader from '@/components/app-header'

// The hub shell: dashboard, daily, live and leaderboard. It owns the header,
// the wayfinding and the page frame, replacing four hand-copied header blocks
// that had already drifted into three different logo sizes.
//
// debate/ and lobby/ stay OUTSIDE this route group deliberately. Those are
// immersive arena routes that render their own chrome and, in the case of
// debate-arena, a fixed bottom action bar. A shared bottom tab bar would paint
// straight over the recording controls.
//
// Route groups do not change URLs. /dashboard is still /dashboard.

export default async function HubLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // Server components cannot write cookies; the proxy handles refresh.
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('username, points')
    .eq('id', user.id)
    .single()

  return (
    // No bg-ink here: body already paints it, and putting it on a positioned
    // wrapper is what buried the old .mesh layer behind its own parent.
    <div className="relative min-h-dvh overflow-x-clip text-chalk">
      <div className="grain" aria-hidden />

      <a
        href="#main"
        className="sr-only z-[60] focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:bg-blaze focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:tracking-widest focus:text-white"
      >
        SKIP TO CONTENT
      </a>

      <AppHeader
        username={profile?.username ?? 'baller'}
        points={profile?.points ?? 0}
      />

      {/* The header is fixed, so it is out of flow and main has to reserve its
          height explicitly: 56px of bar plus the gap. (scroll-padding only
          affects anchor jumps, not initial layout.) pb clears the mobile tab
          bar plus the iOS home indicator so the last card is never trapped. */}
      <main
        id="main"
        className="relative z-10 mx-auto w-full max-w-[1400px] px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-[4.5rem] sm:px-6 lg:pb-20 lg:pt-[5.5rem]"
      >
        {children}
      </main>
    </div>
  )
}
