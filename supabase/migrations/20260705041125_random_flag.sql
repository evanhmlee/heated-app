-- Ball Knowledge: mark whether a debate was a random matchup (worth more points
-- than a bring-your-own debate). Applied via Supabase MCP 2026-07-04.

alter table public.debates
  add column is_random boolean not null default false;

-- Client sets it at insert. Extend the INSERT column grant to include it
-- (scoring columns stay server-only; is_random only affects the points MULTIPLIER,
-- which is applied server-side in the judge route, so a lie here is low-stakes —
-- but keep it insert-only, never updatable).
revoke insert on public.debates from authenticated, anon;
grant insert (user_id, topic_id, topic_text, mode, opponent, user_side, status, difficulty, is_random)
  on public.debates to authenticated;
