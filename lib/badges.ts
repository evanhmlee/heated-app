import type { Difficulty } from '@/lib/debate'

// ── Tiers ─────────────────────────────────────────────────────────
// A badge FAMILY is one chip that levels up in place: earn it at Rookie, keep
// the same chip, and it becomes Starter, then All-Star, then Hall of Fame. The
// tier lives on user_badges.tier, so a family occupies exactly one row per user
// no matter how far they take it.
//
// The four labels are deliberately the same words as the AI opponent's
// DIFFICULTIES in lib/debate.ts, because that ladder is the game's vocabulary
// and reusing it makes a badge tier legible on sight. They are NOT the same
// type, and this file deliberately does not import Difficulty for them: a badge
// tier says how far you have taken one pursuit, a difficulty says who you played,
// and a future change to one must not silently redefine the other. The one place
// they genuinely meet is `certified_hooper`, which is about the opponent.
export const BADGE_TIERS = ['rookie', 'starter', 'all_star', 'hall_of_famer'] as const
export type BadgeTier = (typeof BADGE_TIERS)[number]

export const MAX_TIER = BADGE_TIERS.length

// 1-indexed to match user_badges.tier. 0 is the in-memory "not earned" value and
// is never written to the DB.
export const TIER_LABELS: readonly string[] = ['Rookie', 'Starter', 'All-Star', 'Hall of Fame']

export function tierLabel(tier: number): string {
  return TIER_LABELS[tier - 1] ?? ''
}

/**
 * The score a daily take must reach to count toward the Hot Take family. Lives
 * here rather than in the daily route so the number the badge copy promises and
 * the number the query filters on cannot drift apart.
 */
export const DAILY_ELITE_SCORE = 85

export type Thresholds = readonly [number, number, number, number]

/** The countable fields of BadgeStats. One-off rules read the others. */
export type StatKey =
  | 'wins'
  | 'bestStreak'
  | 'points'
  | 'decidedDebates'
  | 'h2hWins'
  | 'dailyTakes'
  | 'dailyHighScores'
  | 'dailyCrowns'

// `thresholds` present = a tiered family. Absent = a one-off you either have or
// you don't, because there is nothing to count: "win your first debate" and
// "one of the first 100 accounts" cannot be done four times.
export type BadgeDef = {
  slug: string
  name: string
  /** One-off: the whole rule. Family: what the counter measures, e.g. "debates won". */
  description: string
  thresholds?: Thresholds
  /**
   * Sentence template for a family. {n} becomes the tier threshold, {s} becomes
   * a plural 's' (empty at a threshold of 1). Rookie tiers are often exactly 1,
   * which is how "Beat 1 real opponents" shipped.
   */
  tierCopy?: string
  /**
   * Which BadgeStats field this family counts. Declared here rather than in the
   * award switch so awarding and the UI's progress bar read the same number: if
   * they mapped slug to stat separately, a chip could show "12 / 25" while the
   * award path was counting something else entirely.
   */
  stat?: StatKey
}

export const BADGES: BadgeDef[] = [
  // ── One-offs ────────────────────────────────────────────────────
  { slug: 'first_win', name: 'First Blood', description: 'Win your first debate.' },
  {
    slug: 'perfect_game',
    name: 'Flawless',
    description: 'Win a debate with a score of 90 or higher.',
  },
  {
    slug: 'certified_hooper',
    name: 'Certified Hooper',
    description: 'Beat the AI on Hall of Famer difficulty.',
  },
  // Not earnable by play, granted at signup to the first 100 accounts by the
  // handle_new_user trigger. Excluded from qualifyingBadges below, and the
  // dashboard renders it only for members who hold it, never as a locked chip a
  // non-founder could never unlock.
  {
    slug: 'founding',
    name: 'Founding Member',
    description: 'One of the first 100 on Heated. Permanent 20 percent points boost.',
  },

  // ── Families: the AI ladder ─────────────────────────────────────
  {
    slug: 'wins',
    stat: 'wins',
    name: 'Win Column',
    description: 'Debates won.',
    tierCopy: 'Win {n} debates.',
    thresholds: [10, 25, 100, 250],
  },
  {
    slug: 'streak',
    stat: 'bestStreak',
    name: 'On Fire',
    description: 'Longest win streak.',
    tierCopy: 'Win {n} debates in a row.',
    thresholds: [3, 5, 10, 20],
  },
  {
    slug: 'points',
    stat: 'points',
    name: 'Point God',
    description: 'Career points.',
    tierCopy: 'Reach {n} career points.',
    thresholds: [1000, 5000, 20000, 75000],
  },
  {
    slug: 'debates',
    stat: 'decidedDebates',
    name: 'Ironman',
    description: 'Debates finished, win or lose.',
    tierCopy: 'Finish {n} debates.',
    thresholds: [10, 50, 150, 400],
  },

  // ── Families: ranked head to head ───────────────────────────────
  {
    slug: 'h2h_wins',
    stat: 'h2hWins',
    name: 'Head Hunter',
    description: 'Ranked wins against real opponents.',
    tierCopy: 'Beat {n} real opponent{s} in ranked play.',
    thresholds: [1, 10, 40, 120],
  },

  // ── Families: the daily ─────────────────────────────────────────
  {
    slug: 'daily_takes',
    stat: 'dailyTakes',
    name: 'Daily Driver',
    description: 'Daily takes submitted.',
    tierCopy: 'Submit {n} daily takes.',
    thresholds: [5, 25, 100, 300],
  },
  {
    slug: 'daily_elite',
    stat: 'dailyHighScores',
    name: 'Hot Take',
    description: `Daily takes scoring ${DAILY_ELITE_SCORE} or higher.`,
    tierCopy: `Score ${DAILY_ELITE_SCORE} or higher on {n} daily take{s}.`,
    thresholds: [1, 5, 20, 60],
  },
  {
    slug: 'daily_crown',
    stat: 'dailyCrowns',
    name: 'Crown Holder',
    description: 'Days finished top of the daily board.',
    tierCopy: 'Top the daily leaderboard {n} time{s}.',
    thresholds: [1, 5, 20, 60],
  },
]

/** Slug for the signup-granted founding badge (see the migration + trigger). */
export const FOUNDING_BADGE_SLUG = 'founding'

export const BADGE_BY_SLUG: Record<string, BadgeDef> = Object.fromEntries(
  BADGES.map((b) => [b.slug, b])
)

/** How many tiers this badge has: 4 for a family, 1 for a one-off. */
export function maxTierFor(def: BadgeDef): number {
  return def.thresholds ? MAX_TIER : 1
}

const NUM = new Intl.NumberFormat('en-US')

/**
 * The rule for one tier of a badge, e.g. "Win 25 debates." One-offs ignore the
 * tier and return their own description, which is already the whole rule.
 */
export function tierDescription(def: BadgeDef, tier: number): string {
  if (!def.thresholds || !def.tierCopy) return def.description
  const t = Math.min(Math.max(tier, 1), MAX_TIER)
  const n = def.thresholds[t - 1]
  return def.tierCopy.replace('{n}', NUM.format(n)).replace('{s}', n === 1 ? '' : 's')
}

/** Shared number formatting so a chip's rule and its counter agree. */
export function formatCount(n: number): string {
  return NUM.format(n)
}

/** The next threshold to chase, or null once the family is maxed. */
export function nextThreshold(def: BadgeDef, currentTier: number): number | null {
  if (!def.thresholds || currentTier >= MAX_TIER) return null
  return def.thresholds[currentTier]
}

export type BadgeProgress = {
  /** Where the user is now. */
  value: number
  /** The next threshold, or the final one when already maxed. */
  target: number
  /** 0-1, clamped. 1 when maxed. */
  ratio: number
  maxed: boolean
}

/**
 * How close this badge is to its next tier. Returns null for one-offs and for
 * families whose stat the caller did not supply, so a caller that only knows
 * half the world renders a bar for the half it knows and nothing for the rest,
 * rather than a misleading "0 / 25".
 *
 * The bar is measured from the PREVIOUS threshold, not from zero: at 24 of 25
 * wins a from-zero bar sits at 96% and looks finished for the next 15 wins,
 * while a between-tiers bar reads as almost there and then resets, which is what
 * the player is actually experiencing.
 */
export function badgeProgress(def: BadgeDef, stats: BadgeStats): BadgeProgress | null {
  if (!def.thresholds || !def.stat) return null
  const value = stats[def.stat]
  if (value === undefined) return null

  const tier = tierFor(value, def.thresholds)
  if (tier >= MAX_TIER) {
    const target = def.thresholds[MAX_TIER - 1]
    return { value, target, ratio: 1, maxed: true }
  }
  const floor = tier === 0 ? 0 : def.thresholds[tier - 1]
  const target = def.thresholds[tier]
  const span = target - floor
  const ratio = span <= 0 ? 0 : Math.min(1, Math.max(0, (value - floor) / span))
  return { value, target, ratio, maxed: false }
}

// Highest tier a counter has reached. 0 means not earned at all, which is never
// persisted.
function tierFor(value: number, thresholds: Thresholds): number {
  let tier = 0
  for (let i = 0; i < thresholds.length; i++) {
    if (value >= thresholds[i]) tier = i + 1
  }
  return tier
}

export type BadgeAward = { slug: string; tier: number }

/**
 * Every stat a badge might key on. All optional on purpose: each award site
 * knows only its own half of the world. The judge route has no idea how many
 * daily takes you have submitted, and the daily route has no idea what
 * difficulty you last beat, so a rule is evaluated only when its input is
 * actually present rather than being silently evaluated against a zero.
 */
export type BadgeStats = {
  won?: boolean
  userScore?: number
  difficulty?: Difficulty
  wins?: number
  bestStreak?: number
  points?: number
  /** Debates that reached a result, win or lose. */
  decidedDebates?: number
  h2hWins?: number
  dailyTakes?: number
  dailyHighScores?: number
  dailyCrowns?: number
}

/**
 * Which badges, and at what tier, the user now qualifies for. Idempotent: the
 * award path compares against what is already held and only ever moves a tier
 * upward, so returning a tier the user already has is harmless.
 */
export function qualifyingBadges(stats: BadgeStats): BadgeAward[] {
  const out: BadgeAward[] = []
  const one = (slug: string, earned: boolean | undefined) => {
    if (earned) out.push({ slug, tier: 1 })
  }
  const family = (slug: string, value: number | undefined) => {
    if (value === undefined) return
    const def = BADGE_BY_SLUG[slug]
    if (!def?.thresholds) return
    const tier = tierFor(value, def.thresholds)
    if (tier > 0) out.push({ slug, tier })
  }

  one('first_win', stats.won && (stats.wins ?? 0) >= 1)
  one('perfect_game', stats.won && (stats.userScore ?? 0) >= 90)
  one('certified_hooper', stats.won && stats.difficulty === 'hall_of_famer')

  // Families are driven off def.stat, so adding one to the catalog is a single
  // edit rather than a catalog entry plus a line here that can be forgotten.
  for (const def of BADGES) {
    if (def.stat) family(def.slug, stats[def.stat])
  }

  return out
}
