import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { readSourceHealth } from '@/lib/data-health'

// On-demand answer to "is the debate grounding actually working right now".
//
// Reads only. It makes no live ESPN calls, so polling it cannot cause the
// outage it reports on, and it costs nothing. The nightly canary in
// /api/cron/refresh-nba-teams is what actually exercises the sources; this just
// exposes what it found, plus how fresh each cache is.
//
// Auth: same fail-closed CRON_SECRET bearer as the cron routes. Nothing in here
// is a secret, but it maps the app's data infrastructure, and an open endpoint
// is one more surface to reason about for no benefit.
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/health/nba
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const admin = supabaseAdmin()
    const newest = (table: string) =>
      admin
        .from(table)
        .select('updated_at', { count: 'exact' })
        .order('updated_at', { ascending: false })
        .limit(1)

    const [sources, teams, stats] = await Promise.all([
      readSourceHealth(),
      newest('nba_player_teams'),
      newest('nba_player_stats'),
    ])

    // Mirrors the staleness cutoffs the readers actually enforce, so this says
    // "the judge is ignoring this cache" rather than merely "it is oldish".
    const freshness = (
      res: { data: { updated_at: string }[] | null; count: number | null },
      staleAfterDays: number
    ) => {
      const at = res.data?.[0]?.updated_at ?? null
      const ageHours = at ? Math.round((Date.now() - new Date(at).getTime()) / 3600000) : null
      return {
        rows: res.count ?? 0,
        newest: at,
        age_hours: ageHours,
        stale: ageHours === null || ageHours > staleAfterDays * 24,
      }
    }

    const caches = {
      nba_player_teams: freshness(teams, 7),
      nba_player_stats: freshness(stats, 30),
    }
    const healthy =
      sources.length > 0 &&
      sources.every((s) => s.status === 'ok') &&
      !caches.nba_player_teams.stale

    // nba_player_stats is filled on demand, so an empty or old one only means
    // nobody has debated a new player lately. It is reported but not counted
    // against overall health.
    return NextResponse.json({ healthy, sources, caches })
  } catch (err) {
    console.error('health/nba route error', err)
    return NextResponse.json({ error: 'health check failed' }, { status: 500 })
  }
}
