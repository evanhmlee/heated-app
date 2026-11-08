-- Applied to prod via Supabase MCP 2026-08-15.
--
-- Badges gain four tiers: Rookie, Starter, All-Star, Hall of Fame. A badge
-- FAMILY levels up IN PLACE rather than minting a new badge per tier, so a user
-- still holds exactly one row per family and the dashboard stays one chip per
-- pursuit instead of four.
--
-- Thresholds and per-tier copy live in lib/badges.ts, not here. This table only
-- needs a row per slug so user_badges has something to reference; duplicating
-- the ladder in SQL would be a second source of truth to keep in sync, and the
-- existing "keep in sync with lib/badges.ts" comment is already one too many.
alter table public.user_badges
  add column if not exists tier smallint not null default 1
    check (tier between 1 and 4);

comment on column public.user_badges.tier is
  '1-4, matching BADGE_TIERS in lib/badges.ts. One-off badges are always 1. Only ever moves upward (see lib/badge-award.ts).';

-- ── Retire the four flat badges that families replace ────────────
-- Safe to delete rather than migrate: all four had zero holders when this ran
-- (verified against user_badges), while first_win (3) and founding (4) are kept
-- because they have holders and are genuine one-offs anyway. The FK from
-- user_badges is ON DELETE CASCADE, so this cannot orphan a row.
--   win_10   -> the `wins` family (10 is now its Rookie tier)
--   streak_3 -> the `streak` family (3 is now its Rookie tier)
--   streak_5 -> the `streak` family (5 is now its Starter tier)
--   point_god -> the `points` family, which keeps the name
delete from public.badges where slug in ('win_10', 'streak_3', 'streak_5', 'point_god');

-- ── Seed the families + keep the surviving one-offs ──────────────
-- description here is the FAMILY description (what the counter measures); the
-- per-tier sentence is rendered from tierCopy in lib/badges.ts.
insert into public.badges (slug, name, description) values
  ('wins',        'Win Column',   'Debates won.'),
  ('streak',      'On Fire',      'Longest win streak.'),
  ('points',      'Point God',    'Career points.'),
  ('debates',     'Ironman',      'Debates finished, win or lose.'),
  ('h2h_wins',    'Head Hunter',  'Ranked wins against real opponents.'),
  ('daily_takes', 'Daily Driver', 'Daily takes submitted.'),
  ('daily_elite', 'Hot Take',     'Daily takes scoring 85 or higher.'),
  ('daily_crown', 'Crown Holder', 'Days finished top of the daily board.')
on conflict (slug) do update
  set name = excluded.name, description = excluded.description;
