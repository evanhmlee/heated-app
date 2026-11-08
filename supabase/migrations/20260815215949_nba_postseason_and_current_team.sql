-- Applied to prod via Supabase MCP 2026-08-15.
--
-- Two gaps the judge kept arguing blind through:
--
--   1. POSTSEASON split. Basketball argument runs on this more than on any other
--      number ("he disappears in June", "he raised his game"), and the judge had
--      only regular-season averages, so it was fact-checking playoff claims out
--      of its own stale memory. ESPN exposes it on the same endpoint behind
--      seasontype=3, so it costs one extra request on a cache miss and nothing
--      at all on a hit.
--
--   2. CURRENT team. It already lived in nba_player_teams, refreshed by a
--      nightly cron, but that cron only runs on a production deployment and the
--      app currently lives on dev, so the roster cache had gone 20 days stale
--      and its 7-day cutoff meant EVERY current-team lookup was returning null.
--      The athlete profile carries the team on a request lib/nba-espn.ts already
--      makes for the full name, so caching it here restores the fact with no
--      cron in the loop at all. nba_player_teams stays as the bulk fallback.
alter table public.nba_player_stats
  add column if not exists games_played smallint,
  add column if not exists po_gp        smallint,
  add column if not exists po_ppg       numeric(4,1),
  add column if not exists po_rpg       numeric(4,1),
  add column if not exists po_apg       numeric(4,1),
  -- Null for a retired player ON PURPOSE. Their profile still carries the last
  -- team they played for, and writing that into a column named "current" is how
  -- you end up telling the judge Jordan currently plays for the Wizards.
  add column if not exists current_team text,
  add column if not exists is_active    boolean;
