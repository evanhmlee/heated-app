import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import {
  listEspnTeams,
  listEspnRoster,
  normalizePlayerName,
  searchEspnAthleteId,
  getEspnCareer,
} from '@/lib/nba-espn'
import { recordSourceHealth } from '@/lib/data-health'

export const maxDuration = 60

// A healthy full refresh is 30 teams / ~450-570 players. If ESPN half-answers,
// we must NOT treat a partial pull as the new truth: writing it would drop real
// players from the cache, and a missing player silently degrades to "no data"
// for the judge. Below either floor we abort and leave yesterday's good cache
// in place.
const MIN_TEAMS = 25
const MIN_PLAYERS = 300

type RosterOutcome =
  | { ok: true; teams: number; players: number; removed: number; refreshed_at: string }
  | { ok: false; detail: string }

// Pulls all 30 ESPN rosters (~31 requests) and rewrites player -> current team.
// The judge and opponent read the cache, never ESPN directly: 31 calls will not
// fit in a 60s budget, and a live outage must never break a debate.
async function refreshRosters(): Promise<RosterOutcome> {
  // One timestamp for the whole run: rows still carrying an older one after
  // the upsert were not on any current roster, so they get swept below.
  const runAt = new Date().toISOString()
  const teams = await listEspnTeams()

  const rows: {
    espn_player_id: string
    player_name: string
    normalized_name: string
    team_name: string
    espn_team_id: string
    updated_at: string
  }[] = []
  const seen = new Set<string>()
  let failedTeams = 0

  for (const team of teams) {
    let roster
    try {
      roster = await listEspnRoster(team.id)
    } catch (err) {
      // One bad team shouldn't abort the run; the floors below decide whether
      // what we did get is trustworthy enough to write.
      console.error(`refresh-nba-teams: roster failed for ${team.name}`, err)
      failedTeams++
      continue
    }
    for (const p of roster) {
      const normalized = normalizePlayerName(p.name)
      // Two-way players and duplicate names across rosters: first roster wins,
      // and normalized_name is unique, so dedupe here rather than letting the
      // upsert collide within a single batch.
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      rows.push({
        espn_player_id: p.id,
        player_name: p.name,
        normalized_name: normalized,
        team_name: team.name,
        espn_team_id: team.id,
        updated_at: runAt,
      })
    }
  }

  const okTeams = teams.length - failedTeams
  if (okTeams < MIN_TEAMS || rows.length < MIN_PLAYERS) {
    return {
      ok: false,
      detail: `partial pull (${okTeams} teams, ${rows.length} players), cache left untouched`,
    }
  }

  const admin = supabaseAdmin()
  const { error: upsertErr } = await admin
    .from('nba_player_teams')
    .upsert(rows, { onConflict: 'normalized_name' })
  if (upsertErr) return { ok: false, detail: `upsert failed: ${upsertErr.message}` }

  // Sweep players no longer on any roster (retired, waived, overseas) so the
  // cache can't assert a stale team for someone who left the league.
  const { error: sweepErr, count: swept } = await admin
    .from('nba_player_teams')
    .delete({ count: 'exact' })
    .lt('updated_at', runAt)
  if (sweepErr) console.error('refresh-nba-teams: sweep failed', sweepErr)

  return {
    ok: true,
    teams: okTeams,
    players: rows.length,
    removed: swept ?? 0,
    refreshed_at: runAt,
  }
}

// Michael Jordan retired in 2003, so every number below is frozen forever. A
// canary has to assert something that cannot legitimately change, otherwise it
// becomes a generator of false alarms and gets ignored, which is worse than not
// having one.
const CANARY_NAME = 'Michael Jordan'

// Returns null when healthy, or a human-readable reason when not.
//
// Deliberately calls ESPN directly instead of going through getPlayerFacts. A
// read-through cache will happily answer its own canary out of cache and report
// a source that has been dead for weeks as perfectly healthy, which is the
// exact failure this canary exists to catch.
async function probeCareerStats(): Promise<string | null> {
  const id = await searchEspnAthleteId(CANARY_NAME)
  if (!id) return 'search returned no NBA athlete for the canary name'

  const career = await getEspnCareer(id)
  if (!career) return 'career parse returned null'
  // Ranges rather than exact equality: these bracket the real values (30.1 PPG,
  // 15 seasons) loosely enough to survive an ESPN rounding tweak but tightly
  // enough to catch a parse that has shifted onto the wrong column.
  if (career.ppg < 25 || career.ppg > 35) return `career ppg out of range: ${career.ppg}`
  if (career.seasons < 14 || career.seasons > 16) return `season count out of range: ${career.seasons}`
  if (!career.peak) return 'per-season parse produced no peak season'
  if (!career.awards.length) return 'awards parse produced nothing'
  return null
}

// Nightly (Vercel Cron, see vercel.json). Refreshes the roster cache and probes
// the career-stats source, recording both to data_source_health.
//
// Auth: same fail-closed CRON_SECRET bearer pattern as award-daily.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let rosters: RosterOutcome
  try {
    rosters = await refreshRosters()
  } catch (err) {
    console.error('refresh-nba-teams: roster refresh threw', err)
    rosters = { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
  await recordSourceHealth('espn_rosters', rosters.ok, rosters.ok ? undefined : rosters.detail)

  // Runs even when the roster pull failed. If ESPN is only partly broken, which
  // half still works is the useful diagnostic.
  let canary: string | null
  try {
    canary = await probeCareerStats()
  } catch (err) {
    canary = err instanceof Error ? err.message : String(err)
  }
  await recordSourceHealth('espn_career_stats', !canary, canary ?? undefined)
  if (canary) console.error('refresh-nba-teams: career-stats canary failed', canary)

  const healthy = rosters.ok && !canary

  // 503 rather than 200-with-a-flag when anything is unhealthy. Vercel's cron
  // dashboard surfaces the status code and little else, so a non-2xx is the
  // only signal that reaches a human without paying for alerting. Any roster
  // write above still stands; this is an alarm, not a rollback.
  return NextResponse.json(
    {
      rosters,
      career_stats: canary ? { ok: false, detail: canary } : { ok: true },
    },
    { status: healthy ? 200 : 503 }
  )
}
