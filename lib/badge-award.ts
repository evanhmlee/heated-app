// The one place badges get awarded. Before tiers there were two near-identical
// copies of this block (the judge route and h2h-settle) and the daily had none;
// tiers add "only ever move upward", which is exactly the kind of rule that goes
// wrong when it lives in four places.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  qualifyingBadges,
  tierDescription,
  tierLabel,
  BADGE_BY_SLUG,
  type BadgeStats,
} from '@/lib/badges'

export type AwardedBadge = {
  slug: string
  name: string
  /** The rule for the tier just reached, e.g. "Win 25 debates." */
  description: string
  tier: number
  /** "Rookie" | "Starter" | "All-Star" | "Hall of Fame" */
  tierName: string
  /** false = earned for the first time, true = levelled up from a lower tier. */
  upgraded: boolean
}

/**
 * Award every badge tier `stats` now qualifies for, and return only what
 * actually changed so the caller can show it.
 *
 * Never throws and never lowers a tier. Badge awarding is a garnish on top of a
 * verdict that has already been written and paid out, so a failure here must not
 * take the verdict with it.
 */
export async function awardBadges(
  admin: SupabaseClient,
  userId: string,
  stats: BadgeStats,
  opts: { exclude?: readonly string[] } = {}
): Promise<AwardedBadge[]> {
  try {
    const exclude = new Set(opts.exclude ?? [])
    const qualifying = qualifyingBadges(stats).filter((q) => !exclude.has(q.slug))
    if (qualifying.length === 0) return []

    const slugs = qualifying.map((q) => q.slug)
    const [{ data: catalog }, { data: owned }] = await Promise.all([
      admin.from('badges').select('id, slug, name, description').in('slug', slugs),
      admin.from('user_badges').select('badge_id, tier').eq('user_id', userId),
    ])

    const idBySlug = new Map((catalog ?? []).map((b) => [b.slug as string, b.id as string]))
    const tierByBadgeId = new Map(
      (owned ?? []).map((o) => [o.badge_id as string, (o.tier as number) ?? 1])
    )

    const fresh: { user_id: string; badge_id: string; tier: number }[] = []
    const upgrades: { badgeId: string; tier: number }[] = []
    const awarded: AwardedBadge[] = []

    for (const q of qualifying) {
      const badgeId = idBySlug.get(q.slug)
      // A slug in the catalog constant but not in the badges table means the
      // seed migration has not been applied. Skip it rather than fail the award.
      if (!badgeId) continue

      const held = tierByBadgeId.get(badgeId) ?? 0
      if (q.tier <= held) continue

      if (held === 0) fresh.push({ user_id: userId, badge_id: badgeId, tier: q.tier })
      else upgrades.push({ badgeId, tier: q.tier })

      const def = BADGE_BY_SLUG[q.slug]
      awarded.push({
        slug: q.slug,
        name: def?.name ?? q.slug,
        description: def ? tierDescription(def, q.tier) : '',
        tier: q.tier,
        tierName: tierLabel(q.tier),
        upgraded: held > 0,
      })
    }

    if (fresh.length > 0) {
      // ignoreDuplicates so a racing award that already inserted this row does
      // not clobber the tier it wrote.
      await admin.from('user_badges').upsert(fresh, {
        onConflict: 'user_id,badge_id',
        ignoreDuplicates: true,
      })
    }

    // Upgrades go one at a time with a `.lt('tier', ...)` guard rather than as a
    // batch upsert. That guard is what makes the tier monotonic under
    // concurrency: two award paths racing on the same profile can compute
    // different tiers, and without it the slower writer could drag a Hall of
    // Fame badge back down to Starter. Upgrades are rare (at most a handful per
    // debate), so the extra round trips cost nothing.
    for (const u of upgrades) {
      await admin
        .from('user_badges')
        .update({ tier: u.tier })
        .eq('user_id', userId)
        .eq('badge_id', u.badgeId)
        .lt('tier', u.tier)
    }

    return awarded
  } catch (err) {
    console.error('badge award failed', userId, err)
    return []
  }
}
