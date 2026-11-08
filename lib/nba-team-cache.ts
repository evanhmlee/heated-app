// Server-only reads of the nba_player_teams cache (written nightly by
// /api/cron/refresh-nba-teams from ESPN — see lib/nba-espn.ts).
//
// Read from our own DB, never ESPN directly: 31 live calls will not fit in the
// judge's 60s budget, and an ESPN outage must never break a debate.

import { supabaseAdmin } from './supabase-server'
import { normalizePlayerName } from './nba-espn'

// If the nightly cron dies (ESPN changes shape, blocks us, CRON_SECRET unset),
// rows quietly age. Serving a months-old roster to the judge as VERIFIED fact
// would recreate the exact bug this feature exists to fix, except with false
// authority attached, so past this age the cache reports nothing and the judge
// falls back to JUDGE_RECENCY_RULE (stay neutral on current-roster claims).
// Generous enough to ride out a few failed runs, tight enough that a trade
// window can't silently rot the data.
const STALE_AFTER_DAYS = 7

export async function getCachedCurrentTeam(name: string): Promise<string | null> {
  const normalized = normalizePlayerName(name)
  if (!normalized) return null
  try {
    const admin = supabaseAdmin()
    const { data } = await admin
      .from('nba_player_teams')
      .select('player_name, team_name, updated_at')
      .eq('normalized_name', normalized)
      .maybeSingle()
    if (!data) return null

    const ageMs = Date.now() - new Date(data.updated_at).getTime()
    if (ageMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000) return null

    return `${data.player_name} currently plays for the ${data.team_name}`
  } catch (err) {
    console.error('nba-team-cache lookup failed', name, err)
    return null
  }
}
