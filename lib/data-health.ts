// Liveness record for the best-effort NBA data sources.
//
// Why this exists: every NBA data path in this app fails soft, which is correct
// for availability (an ESPN outage must never break a live debate) but has one
// nasty property. A dead source and a source that simply has nothing to say
// about this player both surface as an empty grounding block. That is not
// hypothetical: stats.nba.com stopped answering and the judge ran completely
// ungrounded for roughly two weeks while every log line and every debate looked
// perfectly normal. Fail-open needs a liveness signal bolted to the side of it,
// or it fails invisibly.
//
// Written by the nightly canary in /api/cron/refresh-nba-teams and, on demand,
// by the read-through path in lib/nba-stats.ts. Read by /api/health/nba.

import { supabaseAdmin } from './supabase-server'

export type SourceName = 'espn_rosters' | 'espn_career_stats'

export type SourceHealth = {
  source: string
  status: 'ok' | 'failing'
  last_ok_at: string | null
  last_fail_at: string | null
  consecutive_failures: number
  detail: string | null
  updated_at: string
}

// Never throws. Health recording is observability, and observability failing
// must not take down the thing it is meant to be observing.
export async function recordSourceHealth(
  source: SourceName,
  ok: boolean,
  detail?: string
): Promise<void> {
  try {
    await supabaseAdmin().rpc('record_source_health', {
      p_source: source,
      p_ok: ok,
      // Stack traces and HTML error pages can be enormous; the first line is
      // the part that identifies the failure.
      p_detail: detail ? detail.slice(0, 500) : null,
    })
  } catch (err) {
    console.error('record_source_health failed', source, err)
  }
}

export async function readSourceHealth(): Promise<SourceHealth[]> {
  try {
    const { data } = await supabaseAdmin()
      .from('data_source_health')
      .select('source, status, last_ok_at, last_fail_at, consecutive_failures, detail, updated_at')
      .order('source')
    return (data ?? []) as SourceHealth[]
  } catch (err) {
    console.error('readSourceHealth failed', err)
    return []
  }
}
