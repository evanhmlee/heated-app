-- Heated: NBA current-team cache (ESPN-sourced).
--
-- Fixes a real judge bug: the AI judge's training cutoff makes it treat TRUE
-- current-season facts (a player's current team) as invented, penalizing
-- debaters for being right (see lib/debate.ts JUDGE_RECENCY_RULE). That rule
-- stops the false penalty; this table lets the judge actually VERIFY a roster
-- claim instead of only staying neutral on it.
--
-- Source: ESPN's public undocumented JSON API (lib/nba-espn.ts), refreshed
-- nightly by /api/cron/refresh-nba-teams. Chosen after live-testing three
-- alternatives on 2026-07-25:
--   stats.nba.com  - blocked from datacenter/Vercel IPs (Akamai + TLS fingerprint)
--   api-sports.io  - free tier hard-capped at the 2024 season ("Free plans do
--                    not have access to this season")
--   balldontlie    - /players/active is paid-gated (401); free tier's team field
--                    is last-known-team and tested stale (LeBron -> Lakers)
--   ESPN           - reachable from a datacenter IP AND verified current
--                    (LeBron + Anfernee Simons both correctly on the 76ers)
--
-- ESPN has no player-name search, so resolving "what team is X on" means
-- pulling all 30 rosters (~31 calls). Fine once a day, far too slow inside the
-- judge's 60s budget, hence a cache rather than a live per-debate lookup.
create table public.nba_player_teams (
  id uuid primary key default gen_random_uuid(),
  espn_player_id text,
  player_name text not null,
  -- lowercased, punctuation-stripped, whitespace-collapsed player_name: the
  -- actual lookup key, so a transcript's freeform spelling still matches.
  normalized_name text not null unique,
  team_name text not null,
  espn_team_id text,
  -- Set to the refresh run's timestamp. Doubles as the staleness signal: the
  -- reader refuses rows older than STALE_AFTER_DAYS so a silently-dead cron
  -- can never feed the judge year-old rosters (the original bug, with false
  -- authority attached).
  updated_at timestamptz not null default now()
);

create index nba_player_teams_normalized_idx on public.nba_player_teams (normalized_name);

alter table public.nba_player_teams enable row level security;

-- Server-only cache: the judge route reads it with the service role, and only
-- the cron writes it with the service role. No client (authenticated or anon)
-- needs access, so RLS-enabled-with-zero-policies (default deny) is deliberate.
