-- Human vs Human (same-device, live exhibition) debates.
--
-- One new column: debates.versus, the per-debate H2H config set once by the
-- host at insert:
--   { guest_name: text, guest_side: text, turn_seconds: 60|90|120,
--     first: 'host'|'guest' }   -- coin flip at setup; leads every round
--
-- Exhibition rules (enforced in app code, recorded here for posterity):
-- no points, no wins/losses/streak, no badges. points_earned is written as 0.
-- H2H debates DO count toward the weekly cap trigger (they still cost real
-- transcription + judge money), which needs no change since it counts all
-- non-error debates.
--
-- versus is insert-only for clients (not in the UPDATE grant): the coin flip
-- and turn config are fixed at setup and must not change mid-debate.

alter table public.debates add column if not exists versus jsonb;

-- Extend the column-level INSERT grant (same pattern as 20260704_random_flag):
-- revoke then re-grant the full allowed column list including versus.
revoke insert on public.debates from authenticated, anon;
grant insert (user_id, topic_id, topic_text, mode, opponent, user_side, status, difficulty, is_random, versus)
  on public.debates to authenticated;
