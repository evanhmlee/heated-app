-- Applied to prod via Supabase MCP 2026-07-25.
--
-- Career stats cache, filled lazily on first mention in a debate (see
-- lib/nba-stats.ts). Separate from nba_player_teams on purpose:
--   nba_player_teams  = CURRENT roster, active players only, bulk-refreshed
--                       nightly, 7-day staleness cutoff (trades move fast)
--   nba_player_stats  = CAREER totals, includes retired players, filled on
--                       demand, 30-day cutoff (career averages barely move,
--                       and never at all for retired players)
-- Keeping them apart means a debate about Jordan does not require him to be on
-- a roster, and a trade does not invalidate a career scoring average.
create table if not exists public.nba_player_stats (
  id uuid primary key default gen_random_uuid(),
  espn_player_id text not null,
  player_name text not null,
  normalized_name text not null unique,
  seasons smallint not null,
  ppg numeric(4,1) not null,
  rpg numeric(4,1) not null,
  apg numeric(4,1) not null,
  -- The team the player last PLAYED a season for, which is not necessarily the
  -- team they are on now (LeBron: 2025-26 stats sit under the Lakers while the
  -- roster cache has him on the 76ers after an offseason move). Stored so the
  -- two can never be conflated when building the grounding block.
  latest_season text,
  latest_season_team text,
  updated_at timestamptz not null default now()
);

create index if not exists nba_player_stats_normalized_name_idx
  on public.nba_player_stats (normalized_name);

-- Server-only, same as nba_player_teams: RLS on with zero policies means the
-- anon/authenticated roles get nothing, and only the service role can read or
-- write it.
alter table public.nba_player_stats enable row level security;
