// The one button system. Kills ad-hoc button markup across the app.
//   primary   → the single hard-edge CTA (flat blaze fill, shimmer, press).
//               Uses .game-btn + .clip-blade — the one blade shape in the app.
//   secondary → hairline shell, brand-red text, rounded like every other surface.
//   ghost     → no chrome, quiet text; for sign-out and tertiary links.
//   danger    → destructive (stop recording).
// Sizes carry the padding AND a >=44px min touch target (a11y).
//
// Use <Button> inside client components; use buttonClasses() to style an
// <a>/<Link> in server components (same look, no client boundary).

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg' | 'xl'

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ')

const BASE =
  // Tracking is NOT set here. It used to be `tracking-widest`, and because
  // Tailwind emits arbitrary values before named ones, `tracking-widest` landed
  // later in the stylesheet and beat `tracking-[0.2em]` on the xl size no
  // matter what order the class string put them in. Each size owns its own
  // tracking instead, so there is nothing to override.
  // whitespace-nowrap: a button label must never wrap. At 320px the xl blade's
  // 'START A DEBATE' broke to two lines and the button grew from 64px to 88px,
  // which reads as broken rather than emphatic.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-mono font-semibold uppercase transition-colors disabled:opacity-60 disabled:pointer-events-none'

const SIZES: Record<Size, string> = {
  // sm was 40px, which contradicted this file's own ">=44px" claim above.
  sm: 'min-h-[44px] px-4 py-2.5 text-[11px] tracking-widest',
  md: 'min-h-[44px] px-6 py-3.5 text-xs tracking-widest',
  lg: 'min-h-[48px] px-8 py-4 text-sm tracking-widest',
  // xl exists for one job: the deck's primary CTA. Nothing else earns it.
  xl: 'min-h-[64px] px-6 py-5 text-sm tracking-[0.2em] sm:px-10 sm:text-base',
}

const VARIANTS: Record<Variant, string> = {
  primary: 'game-btn clip-blade text-white',
  // border-line (0.09 alpha) is 1.35:1, well under the 3:1 WCAG 1.4.11 wants
  // for a boundary that defines a CONTROL, which is why this reads as
  // floating text rather than a button. line-strong is 3.31:1 on ink.
  secondary:
    'press rounded-card border border-line-strong text-blaze-bright hover:border-blaze/50 hover:text-chalk',
  ghost: 'rounded-card text-chalk-2 hover:bg-panel-hi hover:text-chalk',
  // danger stops being bg-red-600 (#dc2626), which is near-identical to
  // --color-blaze (#d81f1f). On a red-branded product red carries no
  // semantic signal, so destructive differentiates by FORM, not by a fourth
  // red. No new hue: a second accent in a locked single-accent brand is the
  // wrong trade.
  danger:
    'press rounded-card border border-line-strong bg-panel-hi text-chalk hover:border-blaze/60 hover:text-blaze-bright',
}

export function buttonClasses(
  variant: Variant = 'primary',
  size: Size = 'md',
  className?: string
): string {
  return cx(BASE, SIZES[size], VARIANTS[variant], className)
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
}

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />
}
