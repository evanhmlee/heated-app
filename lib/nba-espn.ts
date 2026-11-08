// Server-only client for ESPN's public undocumented JSON API.
//
// Why ESPN and not the alternatives (all live-tested 2026-07-25):
//   stats.nba.com  - blocked from datacenter/Vercel IPs (Akamai + TLS fingerprint)
//   api-sports.io  - free tier capped at the 2024 season, cannot see current rosters
//   balldontlie    - current-roster endpoint is paid-gated (401); free tier stale
//   ESPN           - works from a datacenter IP, no API key, and verified CURRENT
//                    (returned LeBron + Anfernee Simons on the 76ers, matching
//                    real-world ground truth that the other two got wrong)
//
// No SLA: this is undocumented and can change or start blocking without notice.
// Every caller treats failure as "no data" rather than an error worth breaking
// a debate over, and the cache reader enforces a staleness cutoff on top.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'

export type EspnTeam = { id: string; name: string }
export type EspnPlayer = { id: string; name: string }

// The 30 NBA teams. ESPN nests these as sports[].leagues[].teams[].team.
export async function listEspnTeams(): Promise<EspnTeam[]> {
  const res = await fetch(`${BASE}/teams`, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`espn teams ${res.status}`)
  const json = (await res.json()) as {
    sports?: { leagues?: { teams?: { team?: { id?: string; displayName?: string } }[] }[] }[]
  }
  const entries = json.sports?.[0]?.leagues?.[0]?.teams ?? []
  return entries
    .map((e) => ({ id: String(e.team?.id ?? ''), name: String(e.team?.displayName ?? '') }))
    .filter((t) => t.id && t.name)
}

// A team's CURRENT roster. ESPN returns `athletes` as a flat array for the NBA,
// but some of its sports group athletes by position ({ position, items[] }), so
// both shapes are handled rather than assumed.
export async function listEspnRoster(teamId: string): Promise<EspnPlayer[]> {
  const res = await fetch(`${BASE}/teams/${teamId}/roster`, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`espn roster ${teamId} ${res.status}`)
  const json = (await res.json()) as {
    athletes?: (
      | { id?: string; fullName?: string; displayName?: string }
      | { items?: { id?: string; fullName?: string; displayName?: string }[] }
    )[]
  }
  const raw = json.athletes ?? []
  const flat = raw.flatMap((a) => ('items' in a && Array.isArray(a.items) ? a.items : [a]))
  return flat
    .map((p) => {
      const entry = p as { id?: string; fullName?: string; displayName?: string }
      return { id: String(entry.id ?? ''), name: String(entry.fullName || entry.displayName || '') }
    })
    .filter((p) => p.name)
}

// Lookup key shared by the writer (cron) and the reader (cache): lowercase,
// drop punctuation (so "D'Angelo"/"DAngelo" and "Jr." variants collapse), and
// squash whitespace.
export function normalizePlayerName(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()
}

// --- Career stats -----------------------------------------------------------
//
// The roster endpoints above only cover ACTIVE players. GOAT/comparison debates
// lean just as hard on retired ones (Jordan, Kobe), so stats resolve a player by
// search first and fall back to nothing rather than guessing.

const SEARCH_URL = 'https://site.web.api.espn.com/apis/search/v2'
const CORE_BASE = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba'

// ESPN's search is cross-sport: "Michael Jordan" also returns an NFL lineman and
// an NCAAF player. uids look like `s:40~l:46~a:1035`, where l:46 is the NBA, so
// that segment is the filter that keeps us from grading basketball claims
// against a football player's stats.
const NBA_LEAGUE_UID = 'l:46'

export async function searchEspnAthleteId(name: string): Promise<string | null> {
  const url = `${SEARCH_URL}?query=${encodeURIComponent(name)}&limit=8`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`espn search ${res.status}`)
  const json = (await res.json()) as {
    results?: { type?: string; contents?: { uid?: string; displayName?: string }[] }[]
  }
  const players = json.results?.find((r) => r.type === 'player')?.contents ?? []
  const target = normalizePlayerName(name)
  const nba = players.filter((p) => String(p.uid ?? '').includes(NBA_LEAGUE_UID))
  // Prefer an exact name match; otherwise take ESPN's own top NBA hit.
  const match =
    nba.find((p) => normalizePlayerName(String(p.displayName ?? '')) === target) ?? nba[0]
  const id = String(match?.uid ?? '').match(/a:(\d+)/)?.[1]
  return id ?? null
}

// A single season's averages. `team` is the team the player FINISHED that season
// on, which for a mid-season trade is not the only team they played for.
export type EspnSeasonLine = {
  season: string
  team: string | null
  gp: number
  ppg: number
  rpg: number
  apg: number
}

export type EspnAward = { name: string; count: number }

// Career POSTSEASON averages. Basketball argument runs on this split more than
// on any other ("he disappears in June", "he raised his game"), and judging it
// from the model's own memory is exactly the sort of confident-wrong fact that
// grounding exists to prevent. ESPN exposes it behind the same stats endpoint
// with seasontype=3.
export type EspnPostseason = { gp: number; ppg: number; rpg: number; apg: number }

export type EspnCareer = {
  fullName: string
  seasons: number
  gamesPlayed: number
  ppg: number
  rpg: number
  apg: number
  latestSeason: string | null
  latestSeasonTeam: string | null
  recent: EspnSeasonLine | null
  peak: EspnSeasonLine | null
  awards: EspnAward[]
  postseason: EspnPostseason | null
  // Straight off the athlete profile, which we already fetch for the full name,
  // so this costs no extra request. It is also LIVE, where the bulk roster cache
  // is only as fresh as its last cron run.
  currentTeam: string | null
  active: boolean
}

// ESPN gives team slugs ("los-angeles-lakers"). Title-casing each word is right
// for 29 of 30 teams; "la-clippers" is the one that needs help.
const SLUG_WORD_FIXUPS: Record<string, string> = { la: 'LA' }

function prettyTeamSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => SLUG_WORD_FIXUPS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ESPN returns awards in no useful order and the grounding block only quotes the
// first few, so rank them by the weight they actually carry in an argument.
// Anything unlisted sorts last rather than being dropped.
const AWARD_RANK = [
  'MVP',
  'Finals MVP',
  'Defensive Player of the Year',
  'Rookie of the Year',
  'All-NBA 1st Team',
  'All-NBA 2nd Team',
  'All-NBA 3rd Team',
  'All-Defensive 1st Team',
  'All-Defensive 2nd Team',
  'Sixth Man of the Year',
  'Most Improved Player',
  'All-Star MVP',
]

type RawBio = { awards?: { league?: string; name?: string; displayCount?: string }[] }

// NOTE: ESPN's NBA award taxonomy has no "champion" entry (verified against the
// full 2024 award list), so rings are NOT available here and must never be
// inferred from Finals MVP: Kobe has 5 rings and 2 Finals MVPs, Robert Horry has
// 7 rings and zero individual awards at all. Championship counts are settled
// pre-cutoff history the model already knows, and the only volatile one, the
// most recent title, is pinned by REIGNING_NBA_CHAMPION in lib/debate.ts.
// All-Star selections are likewise absent (only All-Star MVP is an award).
function parseAwards(bio: RawBio): EspnAward[] {
  const rank = (name: string) => {
    const i = AWARD_RANK.indexOf(name)
    return i >= 0 ? i : AWARD_RANK.length
  }
  return (bio.awards ?? [])
    // Jordan's list carries 5 NCAA honors (Wooden, Naismith, AP POY) alongside
    // his NBA ones. Citing a college award as an NBA credential in a pro debate
    // is exactly the kind of confident-wrong fact grounding exists to prevent.
    .filter((a) => a.league === 'nba')
    .map((a) => ({
      name: String(a.name ?? ''),
      count: Number(String(a.displayCount ?? '').replace(/x$/i, '')) || 1,
    }))
    .filter((a) => a.name)
    .sort((a, b) => rank(a.name) - rank(b.name))
}

type RawSeasonRow = {
  teamId?: string
  teamSlug?: string
  season?: { year?: number; displayName?: string }
  stats?: string[]
}

// Games a season needs before grounding quotes it (see getEspnCareer). 20 is
// about a quarter of a season, enough that an average means something; 41 is
// half, the floor for calling a season someone's best.
const MIN_RECENT_SEASON_GAMES = 20
const MIN_PEAK_SEASON_GAMES = 41

// ESPN returns parallel `labels` and `totals` arrays rather than named fields,
// so values are read by label index instead of a hardcoded position (the column
// set has changed before and would otherwise silently shift every stat by one).
export async function getEspnCareer(athleteId: string): Promise<EspnCareer | null> {
  // seasontype=3 is the postseason split. Requested unqualified for the regular
  // season because the default IS regular season (verified live), and pinning
  // seasontype=2 would be a second thing to keep true if ESPN ever reorders it.
  const [statsRes, profileRes, bioRes, poRes] = await Promise.all([
    fetch(`${CORE_BASE}/athletes/${athleteId}/stats`, { signal: AbortSignal.timeout(10000) }),
    fetch(`${CORE_BASE}/athletes/${athleteId}`, { signal: AbortSignal.timeout(10000) }),
    fetch(`${CORE_BASE}/athletes/${athleteId}/bio`, { signal: AbortSignal.timeout(10000) }),
    fetch(`${CORE_BASE}/athletes/${athleteId}/stats?seasontype=3`, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null),
  ])
  if (!statsRes.ok) throw new Error(`espn stats ${athleteId} ${statsRes.status}`)

  const stats = (await statsRes.json()) as {
    categories?: { name?: string; labels?: string[]; totals?: string[]; statistics?: RawSeasonRow[] }[]
  }
  const avg = stats.categories?.find((c) => c.name === 'averages')
  const labels = avg?.labels ?? []
  const totals = avg?.totals ?? []
  if (!labels.length || !totals.length) return null

  const num = (label: string): number => {
    const i = labels.indexOf(label)
    const v = i >= 0 ? Number(totals[i]) : NaN
    return Number.isFinite(v) ? v : 0
  }
  const ppg = num('PTS')
  if (!ppg) return null // no scoring line means we resolved something unusable

  const rowNum = (r: RawSeasonRow, label: string): number => {
    const i = labels.indexOf(label)
    const v = i >= 0 ? Number(r.stats?.[i]) : NaN
    return Number.isFinite(v) ? v : 0
  }

  // Whenever a player is traded mid-season ESPN emits one row per team PLUS a
  // combined "Totals" row, so the raw row count overstates seasons played
  // (Harden: 23 rows, 17 actual seasons). Group by season year and collapse.
  const byYear = new Map<number, RawSeasonRow[]>()
  for (const r of avg?.statistics ?? []) {
    const y = r.season?.year
    if (typeof y !== 'number') continue
    const group = byYear.get(y)
    if (group) group.push(r)
    else byYear.set(y, [r])
  }

  const seasonLines: EspnSeasonLine[] = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => {
      // The Totals row is identifiable structurally: it is the only one with no
      // teamId. Matching on the literal string "Totals" would break the moment
      // ESPN reworded it. With no Totals row, the lone team row IS the season.
      const line = group.find((r) => !r.teamId) ?? group[0]
      // Totals rows carry no team, so name the team the player finished the
      // season on instead of leaving a traded player's season teamless.
      const teamRow = [...group].reverse().find((r) => r.teamId && r.teamSlug)
      return {
        season: String(line.season?.displayName ?? ''),
        team: teamRow?.teamSlug ? prettyTeamSlug(teamRow.teamSlug) : null,
        gp: rowNum(line, 'GP'),
        ppg: rowNum(line, 'PTS'),
        rpg: rowNum(line, 'REB'),
        apg: rowNum(line, 'AST'),
      }
    })

  // A season line is quoted to the judge as VERIFIED in the same shape whether
  // it covers 82 games or 3, and it is cached for 30 days. From opening night a
  // three-game hot start would read as "his 2026-27 season: 34 PPG" and could
  // even win "best scoring season". So the recent line needs a real sample and
  // the peak needs half a season; short seasons still count toward `seasons`.
  // Falls back to no line at all rather than a misleading one.
  const recent =
    [...seasonLines].reverse().find((s) => s.gp >= MIN_RECENT_SEASON_GAMES) ?? null
  const peak = seasonLines
    .filter((s) => s.gp >= MIN_PEAK_SEASON_GAMES)
    .reduce<EspnSeasonLine | null>((best, s) => (!best || s.ppg > best.ppg ? s : best), null)

  let fullName = ''
  let currentTeam: string | null = null
  let active = false
  if (profileRes.ok) {
    const profile = (await profileRes.json()) as {
      athlete?: {
        fullName?: string
        displayName?: string
        active?: boolean
        team?: { displayName?: string }
      }
    }
    const athlete = profile.athlete
    fullName = String(athlete?.fullName || athlete?.displayName || '')
    active = athlete?.active === true
    // A retired player keeps a `team` on their profile (the last one they played
    // for), so this is only a CURRENT-team claim while they are active. Stating
    // "Jordan currently plays for the Wizards" would be the exact class of
    // confident-wrong fact this whole file exists to stop.
    const team = String(athlete?.team?.displayName ?? '')
    currentTeam = active && team ? team : null
  }

  // Postseason is additive: no playoff appearances, or a failed request, costs
  // us one grounding line. It must never null out a career we already parsed.
  let postseason: EspnPostseason | null = null
  if (poRes?.ok) {
    try {
      const po = (await poRes.json()) as {
        categories?: { name?: string; labels?: string[]; totals?: string[] }[]
      }
      const poAvg = po.categories?.find((c) => c.name === 'averages')
      const poLabels = poAvg?.labels ?? []
      const poTotals = poAvg?.totals ?? []
      const poNum = (label: string): number => {
        const i = poLabels.indexOf(label)
        const v = i >= 0 ? Number(poTotals[i]) : NaN
        return Number.isFinite(v) ? v : 0
      }
      const gp = poNum('GP')
      // Zero games played is a player who never made the playoffs, which is a
      // real fact but not one worth a line of prompt.
      if (gp > 0) {
        postseason = { gp, ppg: poNum('PTS'), rpg: poNum('REB'), apg: poNum('AST') }
      }
    } catch {
      postseason = null
    }
  }

  // Awards are additive: a bio failure costs us honors, it must not null out a
  // career line we already parsed successfully.
  let awards: EspnAward[] = []
  if (bioRes.ok) {
    try {
      awards = parseAwards((await bioRes.json()) as RawBio)
    } catch {
      awards = []
    }
  }

  return {
    fullName,
    seasons: seasonLines.length,
    gamesPlayed: num('GP'),
    ppg,
    rpg: num('REB'),
    apg: num('AST'),
    latestSeason: recent?.season ?? null,
    latestSeasonTeam: recent?.team ?? null,
    recent,
    peak,
    awards,
    postseason,
    currentTeam,
    active,
  }
}
