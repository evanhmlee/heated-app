-- Daily hot takes, phase 1: open-ended prompts + shareable takes.
--
-- Two independent changes that ship together because they are both groundwork
-- for the same feature (a public, social daily), and both touch the daily tables.
--
-- 1. OPEN-ENDED PROMPTS. The daily has always been a two-sided matchup: a topic
--    plus stance_a and stance_b, rendered as side-picker chips. Hot takes mostly
--    do not come from picking one of two offered positions, they come from an
--    open question, so the generator can now produce either shape and the day
--    says which one it is. `format` is a column rather than an inference from
--    "are the stances null", because the UI branches on it before it has read
--    them and because an inferred format silently changes meaning the first time
--    a generation half-fails.
--
-- 2. SHAREABLE TAKES. Same model as debates (20260806_verdict_share_controls):
--    sharing is INSTANT, the row id is the link, and these columns are the way
--    back out rather than the way in. A graded take is shareable the moment it
--    exists, because the moment someone is hyped about a score is the moment
--    they would post it, and a "create a link" step in front of that is where
--    the loop dies.
--
-- Applied via Supabase MCP 2026-08-17. This file is the repo record.

-- ── 1 · daily_prompts: two shapes of prompt ──────────────────────
alter table public.daily_prompts
  add column if not exists format text not null default 'sides'
    check (format in ('sides', 'open'));

comment on column public.daily_prompts.format is
  'sides = a two-sided matchup carrying stance_a and stance_b. open = a single open question with no offered positions.';

-- Existing rows are all two-sided and keep both stances, so they satisfy the
-- constraint below under the 'sides' default. Only open days may omit them.
alter table public.daily_prompts alter column stance_a drop not null;
alter table public.daily_prompts alter column stance_b drop not null;

-- The format and the stances must agree. Without this a generation that half
-- failed could write an 'open' row still carrying stances (so the arena renders
-- side chips on a day that has no sides) or a 'sides' row with none (chips that
-- render nothing). Both are recoverable bugs that would only show up on the one
-- day they happened, which is the worst time to find them.
alter table public.daily_prompts
  drop constraint if exists daily_prompts_format_matches_stances;
alter table public.daily_prompts
  add constraint daily_prompts_format_matches_stances check (
    (format = 'sides' and stance_a is not null and stance_b is not null)
    or
    (format = 'open' and stance_a is null and stance_b is null)
  );

-- ── 2 · daily_attempts: share controls ───────────────────────────
-- No share_receipts twin of the debates column: the judge's note is shown on the
-- public feed to every signed-in user anyway, so a flag that hid it only on the
-- shared copy would be promising a privacy it does not deliver.
alter table public.daily_attempts
  add column if not exists share_revoked boolean not null default false,
  add column if not exists share_name    boolean not null default true;

comment on column public.daily_attempts.share_revoked is
  'Author took the public take down. /t/[id] and the OG card both 404 when true.';
comment on column public.daily_attempts.share_name is
  'Publish the author''s username. False renders the take anonymously.';

-- Least privilege, re-asserted rather than assumed. daily_attempts already has
-- ALL client writes revoked (the score is service-role computed and must never
-- be forgeable), so these columns arrive unwritable. Restating it here means the
-- guarantee is visible in the migration that adds the columns rather than only
-- in the one from 2026-07-06.
revoke insert, update, delete on public.daily_attempts from authenticated, anon;

-- Deliberately NO anon select policy, on either table.
--
-- The public take page has to serve signed-out visitors, and the tempting way to
-- do that is an anon policy like "using (share_revoked = false)". That would
-- expose every unrevoked take in the database to anyone holding the anon key,
-- since RLS cannot see which id the URL asked for. /t/[id] reads by exact id
-- with the service role instead, which is the same call the debate share page
-- makes and for the same reason.
