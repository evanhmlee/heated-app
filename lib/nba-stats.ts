// Server-only career-stats lookups, cached in nba_player_stats.
//
// History (2026-07-25): this file used to call stats.nba.com's undocumented
// endpoints directly. Live testing showed those now time out even from a
// residential IP, and they were already blocked from Vercel's datacenter
// ranges. Because every path here fails soft, the judge had silently been
// receiving ZERO stats grounding rather than anything visibly breaking.
// Rewritten onto ESPN, the same source that fixed the roster bug, and the
// silent-death problem itself is now covered by lib/data-health.ts.
//
// Read-through cache rather than a bulk cron: career averages are needed for
// retired players too (Jordan, Kobe), who appear on no roster, so there is no
// finite list to iterate nightly. Instead the first debate to mention a player
// pays one ESPN round-trip and every later debate reads the DB.

import { supabaseAdmin } from './supabase-server'
import { normalizePlayerName, searchEspnAthleteId, getEspnCareer } from './nba-espn'
import { recordSourceHealth } from './data-health'

// Career averages move by hundredths over a season and never at all for retired
// players, so this is about pruning stale name/team drift rather than accuracy.
// Far looser than the roster cache's 7 days, where a trade makes a row wrong
// outright.
const STALE_AFTER_DAYS = 30

// Current team is the one fact in this row that does NOT age like the rest of
// it. A career average is still basically right at 29 days; a roster slot can be
// wrong the morning after a trade. This deliberately matches the roster cache's
// cutoff in lib/nba-team-cache.ts, which exists for exactly this reason. Without
// it the 30-day window above would publish a stale team under the same VERIFIED
// banner the judge is told to penalize contradictions against, so a user who
// correctly named the new team would be marked down for being right.
const TEAM_STALE_AFTER_DAYS = 7

// Bump whenever the shape of what we cache changes. Rows written by an older
// version count as stale regardless of age, so a schema change refills itself on
// next lookup instead of serving half-populated rows for a further 30 days.
// v2 (2026-07-25): added per-season lines and awards, and fixed a seasons count
// that counted ESPN's mid-season-trade rows as extra seasons.
// v3 (2026-08-15): added the postseason split, games played, and current team.
// v4 (2026-10-18): recent and peak seasons need 20 and 41 games, so an
// in-progress season's first week is never quoted as a season line.
const STATS_VERSION = 4

// Enough to establish a résumé without burning the prompt on a decade of
// All-Rookie selections. Ordered by prestige upstream, so this keeps the ones
// that actually carry an argument.
const MAX_AWARDS_QUOTED = 6

type CachedStats = {
  player_name: string
  seasons: number
  games_played: number | null
  ppg: number
  rpg: number
  apg: number
  recent_season: string | null
  recent_team: string | null
  recent_ppg: number | null
  recent_rpg: number | null
  recent_apg: number | null
  peak_season: string | null
  peak_ppg: number | null
  awards: { name: string; count: number }[] | null
  po_gp: number | null
  po_ppg: number | null
  po_rpg: number | null
  po_apg: number | null
  current_team: string | null
  is_active: boolean | null
}

// Averages always read with one decimal, the way a box score prints them.
// Without this, JS drops the trailing zero and the block says "Jordan career:
// 30.1 PPG / 6.2 RPG / 5.3 APG" but "Jordan in 2002-03: 20 PPG", which looks
// like a rounded guess sitting next to measured numbers.
const n1 = (v: number) => v.toFixed(1)

// One line per fact rather than one blob, so the grounding block can bullet them
// and the model can quote a single number without dragging the rest along.
// `teamFresh` gates ONLY the current-team line. False on every stale-fallback
// path, where the row's age is unbounded, and on a cache hit older than
// TEAM_STALE_AFTER_DAYS. The career and playoff lines are still worth serving in
// both cases; a months-old career average is fine, a months-old roster is not.
function formatFacts(s: CachedStats, teamFresh: boolean): string[] {
  // Games played rides along on the career line rather than taking its own,
  // because "over 19 seasons" invites a durability argument that "over 19
  // seasons and 1,392 games" settles.
  const games = s.games_played ? `, ${s.games_played} games` : ''
  const facts: string[] = [
    `${s.player_name} career regular season: ${n1(s.ppg)} PPG / ${n1(s.rpg)} RPG / ${n1(s.apg)} APG over ${s.seasons} season${s.seasons === 1 ? '' : 's'}${games}`,
  ]

  // The single most-argued split in basketball, and the one the judge previously
  // had to take on faith. Stated next to the career line so "he raised his game
  // in the playoffs" is checkable in one glance rather than being a vibe.
  if (s.po_gp && s.po_ppg != null) {
    facts.push(
      `${s.player_name} career playoffs: ${n1(s.po_ppg)} PPG / ${n1(s.po_rpg ?? 0)} RPG / ${n1(s.po_apg ?? 0)} APG over ${s.po_gp} playoff games`
    )
  }

  if (s.recent_season && s.recent_ppg != null) {
    // "with the Lakers" is scoped to THAT season on purpose. It is not a claim
    // about where the player is now, which the roster-cache line states
    // separately and authoritatively (an offseason trade makes the two differ).
    const team = s.recent_team ? ` (with the ${s.recent_team})` : ''
    facts.push(
      `${s.player_name} in ${s.recent_season}${team}: ${n1(s.recent_ppg)} PPG / ${n1(s.recent_rpg ?? 0)} RPG / ${n1(s.recent_apg ?? 0)} APG`
    )
  }

  // Skipped when peak and most-recent are the same season, which is the normal
  // case for anyone still improving. Repeating the identical line reads as two
  // separate facts and invites the model to treat it as corroboration.
  if (s.peak_season && s.peak_ppg != null && s.peak_season !== s.recent_season) {
    facts.push(`${s.player_name} best scoring season: ${n1(s.peak_ppg)} PPG in ${s.peak_season}`)
  }

  const awards = (s.awards ?? []).slice(0, MAX_AWARDS_QUOTED)
  if (awards.length) {
    // "individual awards" is load-bearing: ESPN exposes no championship count,
    // so this list is scoped, not exhaustive, and the model must not read the
    // absence of rings as zero rings. See parseAwards in lib/nba-espn.ts.
    facts.push(
      `${s.player_name} individual awards: ${awards.map((a) => `${a.count}x ${a.name}`).join(', ')}`
    )
  }

  // Only ever written for a player ESPN reports as ACTIVE, so this cannot claim
  // a retired player is on a roster. Phrased identically to the roster-cache
  // line in lib/nba-team-cache.ts, which is what lets nba-grounding.ts spot a
  // duplicate and drop it.
  if (teamFresh && s.is_active && s.current_team) {
    facts.push(`${s.player_name} currently plays for the ${s.current_team}`)
  }

  return facts
}

const CACHE_COLUMNS =
  'player_name, seasons, games_played, ppg, rpg, apg, recent_season, recent_team, recent_ppg, recent_rpg, recent_apg, peak_season, peak_ppg, awards, po_gp, po_ppg, po_rpg, po_apg, current_team, is_active, stats_version, updated_at'

// Grounding facts for a named player, or [] if the player can't be resolved or
// ESPN is unreachable. Never throws: a stats outage degrades the judge and the
// opponent to un-grounded reasoning, it does not fail a debate.
export async function getPlayerFacts(name: string): Promise<string[]> {
  const normalized = normalizePlayerName(name)
  if (!normalized) return []

  let cached: (CachedStats & { stats_version: number; updated_at: string }) | null = null

  try {
    const { data } = await supabaseAdmin()
      .from('nba_player_stats')
      .select(CACHE_COLUMNS)
      .eq('normalized_name', normalized)
      .maybeSingle()
    cached = (data as (CachedStats & { stats_version: number; updated_at: string }) | null) ?? null

    if (cached && cached.stats_version === STATS_VERSION) {
      const ageMs = Date.now() - new Date(cached.updated_at).getTime()
      if (ageMs < STALE_AFTER_DAYS * 24 * 60 * 60 * 1000) {
        return formatFacts(cached, ageMs < TEAM_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000)
      }
    }
  } catch (err) {
    // A DB read failure is not an ESPN failure, so it is not recorded against
    // the source. Fall through and try the live fetch.
    console.error('nba-stats cache read failed', name, err)
  }

  try {
    const athleteId = await searchEspnAthleteId(name)
    if (!athleteId) {
      // An unresolvable name is not an outage. Nicknames, misspellings and
      // players the extractor invented all land here, and marking ESPN as
      // failing for those would make the health signal cry wolf.
      await recordSourceHealth('espn_career_stats', true)
      return cached ? formatFacts(cached, false) : []
    }

    const career = await getEspnCareer(athleteId)
    await recordSourceHealth('espn_career_stats', true)
    if (!career) return cached ? formatFacts(cached, false) : []

    const row = {
      espn_player_id: athleteId,
      player_name: career.fullName || name,
      normalized_name: normalized,
      seasons: career.seasons,
      games_played: career.gamesPlayed || null,
      ppg: career.ppg,
      rpg: career.rpg,
      apg: career.apg,
      latest_season: career.latestSeason,
      latest_season_team: career.latestSeasonTeam,
      recent_season: career.recent?.season ?? null,
      recent_team: career.recent?.team ?? null,
      recent_ppg: career.recent?.ppg ?? null,
      recent_rpg: career.recent?.rpg ?? null,
      recent_apg: career.recent?.apg ?? null,
      peak_season: career.peak?.season ?? null,
      peak_ppg: career.peak?.ppg ?? null,
      awards: career.awards,
      po_gp: career.postseason?.gp ?? null,
      po_ppg: career.postseason?.ppg ?? null,
      po_rpg: career.postseason?.rpg ?? null,
      po_apg: career.postseason?.apg ?? null,
      current_team: career.currentTeam,
      is_active: career.active,
      stats_version: STATS_VERSION,
      updated_at: new Date().toISOString(),
    }
    await supabaseAdmin()
      .from('nba_player_stats')
      .upsert(row, { onConflict: 'normalized_name' })

    return formatFacts(row, true)
  } catch (err) {
    console.error('nba-stats lookup failed', name, err)
    await recordSourceHealth(
      'espn_career_stats',
      false,
      err instanceof Error ? err.message : String(err)
    )
    // Stale beats nothing: a months-old career average is still basically
    // correct, unlike a months-old roster.
    return cached ? formatFacts(cached, false) : []
  }
}
