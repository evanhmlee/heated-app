'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

// A branded failure. Without this, any RSC exception in the hub drops the user
// on Next's default white error page, which in a committed dark-only brand is
// the most expensive-looking failure available.

export default function HubError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // capture_exceptions in providers.tsx autocaptures unhandled errors, but
    // boundary errors do not always reach it.
    void import('posthog-js').then(({ default: posthog }) => {
      posthog.captureException(error)
    })
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="font-mono text-[11px] font-bold tracking-[0.35em] text-blaze-bright">
        SOMETHING BROKE
      </p>
      <h1 className="mt-4 font-athletic text-3xl font-black uppercase tracking-tight sm:text-4xl">
        That one got away from us.
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-chalk-3">
        The page failed to load. Try again, and if it keeps happening the error
        has been logged on our side.
      </p>
      <div className="mt-7">
        <Button variant="primary" size="lg" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  )
}
