-- Ball Knowledge: Daily Prompt.
-- One AI-generated basketball prompt per (UTC) day. Every user gets exactly ONE
-- attempt: a single graded take (no AI opponent). Attempts are ranked on a daily
-- leaderboard by score; the single highest scorer is awarded bonus profile points
-- once the day closes (end-of-day cron, see /api/cron/award-daily).
--
-- Separate free lane: daily attempts DO NOT touch the debates table, so the weekly
-- debate cap (Free 1/week, Pro 10/week) is untouched. Everyone gets 1 daily/day.
-- Applied via Supabase MCP 2026-07-06. This file is the repo record.

-- ── daily_prompts ────────────────────────────────────────────────
-- One row per calendar (UTC) day. Generated lazily by the first request of the
-- day (service role, ON CONFLICT (prompt_date) DO NOTHING — race-safe). The
-- award fields are filled by the end-of-day cron.
create table public.daily_prompts (
  id uuid primary key default gen_random_uuid(),
  prompt_date date not null unique,
  topic text not null,
  stance_a text not null,
  stance_b text not null,
  winner_user_id uuid references public.profiles(id) on delete set null,
  awarded_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.daily_prompts enable row level security;

-- Today's prompt is public within the app: any signed-in user can read it.
create policy "daily_prompts_select_authenticated"
  on public.daily_prompts for select to authenticated using (true);

-- No client writes ever: the today-route (service role) creates prompts and the
-- cron (service role) awards them.
revoke insert, update, delete on public.daily_prompts from authenticated, anon;
revoke select on public.daily_prompts from anon;

-- ── daily_attempts ───────────────────────────────────────────────
-- One graded take per user per prompt. user_id references profiles(id) (not
-- auth.users) so the leaderboard can embed the username directly via PostgREST.
-- Score/breakdown are server-computed (service-role insert): a client must never
-- be able to set its own score, same reasoning as debates.verdict.
create table public.daily_attempts (
  id uuid primary key default gen_random_uuid(),
  daily_prompt_id uuid not null references public.daily_prompts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  side text,
  argument text not null,
  score smallint not null check (score between 0 and 100),
  -- breakdown: { facts, logic, delivery, note } from the single-take grader
  breakdown jsonb,
  created_at timestamptz not null default now(),
  -- ONE attempt each: the real backstop against double-submits / races.
  unique (daily_prompt_id, user_id)
);

-- Leaderboard queries: highest score first, earliest submission breaks ties.
create index daily_attempts_board_idx
  on public.daily_attempts (daily_prompt_id, score desc, created_at asc);

alter table public.daily_attempts enable row level security;

-- Attempts are public within the app (leaderboard + everyone can see the takes on
-- today's prompt). Content is moderation-gated before insert, so stored takes are
-- clean.
create policy "daily_attempts_select_authenticated"
  on public.daily_attempts for select to authenticated using (true);

-- No client writes: grading + insert happen server-side with the service role.
revoke insert, update, delete on public.daily_attempts from authenticated, anon;
revoke select on public.daily_attempts from anon;
