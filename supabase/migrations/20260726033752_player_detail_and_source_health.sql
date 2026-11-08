-- Applied to prod via Supabase MCP 2026-07-25.
--
-- Two changes that travel together because both exist to keep the debate
-- grounding block honest:
--   1. richer per-player detail (per-season lines + individual awards)
--   2. a liveness record for the best-effort data sources feeding it

-- === 1. Richer player detail ===============================================

alter table public.nba_player_stats
  -- Bumped in lib/nba-stats.ts whenever the shape of what we cache changes.
  -- A row written by an older version is treated as stale no matter how fresh
  -- its timestamp, so a schema change self-heals on next lookup instead of
  -- serving half-populated rows for the full 30-day staleness window.
  add column if not exists stats_version smallint not null default 1,
  -- [{ "name": "MVP", "count": 4 }, ...], NBA only, ranked by prestige.
  -- Deliberately does NOT include championships: ESPN's award taxonomy has no
  -- champion entry, and deriving rings from Finals MVP would be wrong (Kobe:
  -- 5 rings / 2 Finals MVPs; Robert Horry: 7 rings / 0 individual awards).
  add column if not exists awards jsonb not null default '[]'::jsonb,
  -- Most recent completed season. Distinguishes a declining veteran from a
  -- rising star, which a career average alone cannot do.
  add column if not exists recent_season text,
  add column if not exists recent_team text,
  add column if not exists recent_ppg numeric(4,1),
  add column if not exists recent_rpg numeric(4,1),
  add column if not exists recent_apg numeric(4,1),
  -- Best scoring season, for the "at his peak" arguments this app runs on.
  add column if not exists peak_season text,
  add column if not exists peak_ppg numeric(4,1);

-- === 2. Data source liveness ===============================================

-- Every NBA data path in this app fails soft, which is right for availability
-- (an ESPN outage must never break a debate) but means a dead source is
-- indistinguishable from "no data about this player". That is not theoretical:
-- stats.nba.com died and the judge ran ungrounded for roughly two weeks with
-- nothing appearing broken. This table is the missing liveness signal.
create table if not exists public.data_source_health (
  source text primary key,
  status text not null check (status in ('ok', 'failing')),
  last_ok_at timestamptz,
  last_fail_at timestamptz,
  consecutive_failures int not null default 0,
  detail text,
  updated_at timestamptz not null default now()
);

-- Server-only, same posture as the two cache tables: RLS on with zero policies
-- means anon/authenticated get nothing and only the service role can touch it.
alter table public.data_source_health enable row level security;

-- Incrementing consecutive_failures needs to read the old value, which the JS
-- client cannot express in an upsert. Doing it in SQL also keeps the nightly
-- canary and the on-demand read-through path from clobbering each other.
create or replace function public.record_source_health(
  p_source text,
  p_ok boolean,
  p_detail text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.data_source_health (
    source, status, last_ok_at, last_fail_at, consecutive_failures, detail, updated_at
  )
  values (
    p_source,
    case when p_ok then 'ok' else 'failing' end,
    case when p_ok then now() end,
    case when p_ok then null else now() end,
    case when p_ok then 0 else 1 end,
    p_detail,
    now()
  )
  on conflict (source) do update set
    status = excluded.status,
    -- Keep the last KNOWN-GOOD timestamp across a failure so "how long has this
    -- been dead" stays answerable, which is the whole point of the table.
    last_ok_at = case when p_ok then now() else data_source_health.last_ok_at end,
    last_fail_at = case when p_ok then data_source_health.last_fail_at else now() end,
    consecutive_failures = case
      when p_ok then 0
      else data_source_health.consecutive_failures + 1
    end,
    detail = excluded.detail,
    updated_at = now();
end;
$$;

-- Only the service role calls this. Supabase's default privileges grant EXECUTE
-- to anon and authenticated directly, so revoking from public alone is not
-- enough to actually close it off.
revoke execute on function public.record_source_health(text, boolean, text) from public;
revoke execute on function public.record_source_health(text, boolean, text) from anon;
revoke execute on function public.record_source_health(text, boolean, text) from authenticated;
