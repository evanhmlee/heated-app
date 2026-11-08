import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import AppHeader from '@/components/app-header'

// A route-level layout rather than composing AppHeader inside the page, because
// the page is `'use client'`. Importing a server component into a client
// component pulls it into the client bundle, which is exactly the regression
// AppHeader's own comment warns about. A layout keeps the header on the server
// and the form on the client, with the boundary in the right place.
//
// nav={false}: this is a flow. Mid-task, the exit matters more than the four
// destinations, and the exit is CANCEL in the page's sticky action bar. Dropping
// the bottom tab bar also frees the bottom edge for that bar.

export default async function NewDebateLayout({
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
        nav={false}
      />

      {/* pb clears the sticky action bar plus the iOS home indicator. */}
      <main
        id="main"
        className="relative z-10 mx-auto w-full max-w-[1400px] px-5 pb-[calc(8.5rem+env(safe-area-inset-bottom))] pt-[4.5rem] sm:px-6 lg:pt-[5.5rem]"
      >
        {children}
      </main>
    </div>
  )
}
