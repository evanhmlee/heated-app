import {
  Drop,
  Medal,
  SealCheck,
  Basketball,
  Crown,
  Star,
  Trophy,
  Flame,
  ChartLineUp,
  Barbell,
  Sword,
  CalendarCheck,
  Lightning,
  Lock,
} from '@phosphor-icons/react/dist/ssr'
import {
  BADGE_BY_SLUG,
  MAX_TIER,
  maxTierFor,
  tierDescription,
  tierLabel,
  formatCount,
  type BadgeProgress,
} from '@/lib/badges'

// Phosphor glyph per badge slug (SSR variant = no client boundary, safe in the
// server-rendered dashboard). Regular/fill weights only, stroke locked by size.
type Glyph = React.ComponentType<{
  size?: number
  weight?: 'regular' | 'fill'
  className?: string
}>

export const BADGE_ICONS: Record<string, Glyph> = {
  // One-offs
  first_win: Drop,
  perfect_game: SealCheck,
  certified_hooper: Basketball,
  founding: Star,
  // Families
  wins: Trophy,
  streak: Flame,
  points: ChartLineUp,
  debates: Barbell,
  h2h_wins: Sword,
  daily_takes: CalendarCheck,
  daily_elite: Lightning,
  daily_crown: Crown,
}

// A tier you cannot see is not a ladder. This ramps intensity rather than
// swapping hues, which keeps it inside the brand rule: `steel` does the fill
// work and `blaze` stays an accent on borders, glyphs and glows, never a large
// flat wash. Locked -> structural -> warm -> accented -> lit.
const TIER_STYLES: Record<number, { shell: string; badge: string; glyph: string }> = {
  0: {
    shell: 'border-line bg-panel',
    badge: 'bg-panel-hi text-chalk-3',
    glyph: 'text-chalk-3',
  },
  1: {
    shell: 'border-line-strong bg-panel-hi',
    badge: 'bg-steel-soft text-chalk-2 ring-1 ring-line-strong',
    glyph: 'text-chalk-2',
  },
  2: {
    shell: 'border-line-strong bg-steel/15',
    badge: 'bg-steel/40 text-chalk ring-1 ring-line-strong',
    glyph: 'text-chalk',
  },
  3: {
    shell: 'border-blaze/40 bg-steel/25',
    badge: 'bg-steel text-blaze-bright ring-1 ring-blaze/40',
    glyph: 'text-blaze-bright',
  },
  4: {
    shell: 'border-blaze/60 bg-steel/30 shadow-[0_0_28px_-10px_rgba(240,74,56,0.45)]',
    badge:
      'bg-blaze/15 text-blaze-bright ring-1 ring-blaze/50 shadow-[0_0_16px_-4px_rgba(240,74,56,0.6)]',
    glyph: 'text-blaze-bright',
  },
}

// Dots, inline with the tier label, rather than a row of dashes under the name.
// As dashes they read as a second progress bar stacked above the real one, which
// is exactly the wrong thing for the one element whose job is to be unambiguous.
// Inline also buys back a row of height on every family chip.
function TierPips({ tier }: { tier: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-[3px]">
      {Array.from({ length: MAX_TIER }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i < tier ? 'bg-blaze-bright' : 'bg-chalk/20'}`}
        />
      ))}
    </span>
  )
}

/**
 * Presentational badge chip. `tier` is 0 for locked, 1-4 for a family, 1 for an
 * earned one-off. `progress` is optional: without it the chip falls back to
 * stating the rule, which is what the founding badge and any caller that does
 * not know the user's stats will render.
 *
 * Families level up IN PLACE, so this is the only chip a family ever gets.
 */
export default function BadgeChip({
  slug,
  tier,
  progress,
}: {
  slug: string
  tier: number
  progress?: BadgeProgress | null
}) {
  const def = BADGE_BY_SLUG[slug]
  if (!def) return null

  const Glyph = BADGE_ICONS[slug] ?? Medal
  const earned = tier > 0
  const max = maxTierFor(def)
  const tiered = max > 1
  const style = TIER_STYLES[Math.min(tier, MAX_TIER)] ?? TIER_STYLES[0]

  // A locked family advertises its entry tier, so the chip always answers "what
  // do I have to do", never just "what is this".
  const rule = tierDescription(def, earned ? tier : 1)
  const label = tiered && earned ? tierLabel(tier) : ''
  const showBar = tiered && progress != null && !progress.maxed
  const nextRule = tiered && tier < max ? tierDescription(def, tier + 1) : null

  const srState = !earned
    ? 'Locked.'
    : tiered
      ? `Earned, ${tierLabel(tier)} tier, ${tier} of ${max}.`
      : 'Earned.'

  return (
    <div className={`flex items-start gap-3 rounded-card border p-4 ${style.shell}`}>
      <span className="sr-only">
        {srState}
        {showBar && progress ? ` ${formatCount(progress.value)} of ${formatCount(progress.target)} toward the next tier.` : ''}
        {progress?.maxed ? ' Maxed out.' : ''}
      </span>
      <span
        aria-hidden
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.badge}`}
      >
        {earned ? (
          <Glyph size={20} weight="fill" className={style.glyph} />
        ) : (
          <Lock size={18} weight="regular" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className={`truncate text-sm font-semibold ${earned ? 'text-chalk' : 'text-chalk-3'}`}>
            {def.name}
          </p>
          {tiered && (
            <span className="flex shrink-0 items-center gap-2">
              <TierPips tier={tier} />
              {/* At the top tier the label IS the "maxed" signal, so there is no
                  second MAXED pill next to it saying the same thing twice. */}
              {label && (
                <span className="font-mono text-[10px] tracking-[0.18em] text-blaze-bright">
                  {label.toUpperCase()}
                </span>
              )}
            </span>
          )}
        </div>

        {/* The bar replaces two lines of prose ("you have X" + "next is Y") with
            one thing that shows both. Text alternative lives in the sr-only
            block above, so the bar itself is decorative. */}
        {showBar && progress ? (
          <div className="mt-2">
            <div aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-chalk/10">
              <div
                className="h-full rounded-full bg-blaze-bright"
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] text-chalk-3">
              <span className="truncate">{nextRule}</span>
              <span className="shrink-0 font-mono tabular-nums text-chalk-2">
                {formatCount(progress.value)} / {formatCount(progress.target)}
              </span>
            </p>
          </div>
        ) : (
          <p className="mt-1 text-xs leading-snug text-chalk-3">{rule}</p>
        )}
      </div>
    </div>
  )
}
