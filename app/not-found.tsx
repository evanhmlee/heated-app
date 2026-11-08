import Link from 'next/link'
import { buttonClasses } from '@/components/ui/button'

// App-wide 404, on the ink palette. Previously a bad URL rendered Next's
// default white page, which is a jarring exit from a dark-only brand.

export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 text-center text-chalk">
      <div className="grain" aria-hidden />
      <div className="court-floor" aria-hidden />

      <div className="relative z-10">
        <p className="font-athletic text-[clamp(4rem,18vw,9rem)] font-black leading-none text-stroke">
          404
        </p>
        <h1 className="mt-4 font-athletic text-2xl font-black uppercase tracking-tight sm:text-3xl">
          No such page.
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-chalk-3">
          The link is wrong or the page moved. Everything you were looking for is
          back in the locker room.
        </p>
        <div className="mt-8">
          <Link href="/dashboard" className={buttonClasses('primary', 'lg')}>
            Back to the locker room
          </Link>
        </div>
      </div>
    </div>
  )
}
