-- Ball Knowledge: difficulty tiers + points-per-debate + badge catalog seed.
-- Applied via Supabase MCP 2026-07-04.

-- ── debates: difficulty + points earned ──────────────────────────
alter table public.debates
  add column difficulty text not null default 'starter'
    check (difficulty in ('rookie', 'starter', 'all_star', 'hall_of_famer')),
  add column points_earned integer;

-- Lock down INSERT to non-scoring columns (defense in depth: the judge route
-- owns verdict/scores/winner/points via the service role, so a client must not
-- be able to seed a fake win at insert time). Column-level INSERT grant.
revoke insert on public.debates from authenticated, anon;
grant insert (user_id, topic_id, topic_text, mode, opponent, user_side, status, difficulty)
  on public.debates to authenticated;

-- ── badge catalog seed ───────────────────────────────────────────
-- Keep in sync with lib/badges.ts BADGES.
insert into public.badges (slug, name, description) values
  ('first_win', 'First Blood', 'Win your first debate.'),
  ('win_10', 'Regular', 'Win 10 debates.'),
  ('streak_3', 'Heating Up', 'Win 3 debates in a row.'),
  ('streak_5', 'On Fire', 'Win 5 debates in a row.'),
  ('perfect_game', 'Flawless', 'Win a debate with a score of 90 or higher.'),
  ('certified_hooper', 'Certified Hooper', 'Beat the AI on Hall of Famer difficulty.'),
  ('point_god', 'Point God', 'Reach 1,000 career points.')
on conflict (slug) do nothing;
