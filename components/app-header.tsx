import Link from 'next/link'
import Image from 'next/image'
import NavLinks from '@/components/nav-links'
import BottomNav from '@/components/bottom-nav'
import AccountMenu from '@/components/account-menu'
import HeaderWallet from '@/components/header-wallet'
import ShopLink from '@/components/shop-link'

// One header for the whole hub, replacing four hand-copied blocks that had
// already drifted into three different logo sizes.
//
// This stays a SERVER component and mounts four small client islands. Marking
// the whole thing 'use client' would not fail the build and would not throw; it
// would just ship a fatter bundle and a slower first paint, and you would only
// ever find it in a bundle diff. Keep the boundary at NavLinks, HeaderWallet,
// AccountMenu and BottomNav.
//
// 56px tall against the old ~88px, which gives 32px back on every authed
// screen. 375px budget: lockup 32 + 6 + 112 = 150, right cluster 80 + 8 + 36 +
// 8 + 44 = 176, px-5 = 40. That is 366 of 375. The old header needed 289px for
// the logo alone inside 335px of usable width, which is why it overflowed.
//
// ShopLink is the reason that number moved. It is the only right-cluster item
// narrower than 44px below sm (36 x 44, a full-height target on a narrower hit
// area) because the three items plus their gaps do not otherwise fit a 375px
// screen alongside the lockup. Measured, not guessed: see the note on the
// component.

export default function AppHeader({
  username,
  points,
  nav = true,
}: {
  username: string
  points: number
  /**
   * Off inside a flow (debate/new), where a user is mid-task and the exit
   * matters more than the destinations. A flow replaces navigation with a way
   * out, which that screen's sticky action bar provides.
   */
  nav?: boolean
}) {
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-ink/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-5 sm:gap-4 sm:px-6">
          <Link
            href="/dashboard"
            // The wordmark carries the accessible name at most widths, but it is
            // display:none under 360px, which would leave this link named only by
            // an empty alt. Labelling the link itself holds at every width.
            aria-label="Heated, locker room"
            className="flex shrink-0 items-center gap-1.5"
          >
            <Image
              src="/logo-mark.png"
              alt=""
              width={64}
              height={64}
              priority
              className="h-8 w-8 -translate-y-0.5 sm:h-11 sm:w-11 sm:-translate-y-1"
            />
            <Image
              src="/wordmark-red.png"
              alt="Heated"
              width={253}
              height={36}
              priority
              // Mark only below 360px. At 320 the wordmark is 112 of 280
              // usable pixels and the right cluster cannot fit beside it, so
              // the header scrolled sideways. It was already 1px over there
              // before the store icon existed; the icon made it 37.
              className="h-4 w-auto max-[359px]:hidden sm:h-6"
            />
          </Link>

          {nav && <NavLinks />}

          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2">
            <ShopLink />
            <HeaderWallet />
            <AccountMenu username={username} points={points} />
          </div>
        </div>
      </header>

      {nav && <BottomNav />}
    </>
  )
}
