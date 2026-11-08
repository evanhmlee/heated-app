import { createBrowserClient } from '@supabase/ssr'

// Browser-side Supabase client (client components only).
// Server code (route handlers, server components) should build its own
// createServerClient with cookie wiring — never import this there.
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
