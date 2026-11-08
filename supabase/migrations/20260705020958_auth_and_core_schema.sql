-- Ball Knowledge: initial schema — profiles + signup trigger, topics, debates,
-- badges, RLS, and the weekly debate-cap trigger.
-- Applied via Supabase MCP 2026-07-04. This file is the repo record.

-- ── profiles ─────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  avatar_url text,
  is_pro boolean not null default false,
  stripe_customer_id text,
  stripe_subscription_id text,
  points integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Leaderboard is public within the app: any signed-in user can read profiles.
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated using (true);

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Column-level lockdown (lesson from pitchcoachai's 2026-06-30 security audit:
-- a blanket UPDATE grant let users flip is_pro on themselves). Users may only
-- change username and avatar_url; everything else is service-role-only.
revoke update on public.profiles from authenticated, anon;
grant update (username, avatar_url) on public.profiles to authenticated;

-- No client inserts/deletes ever; the signup trigger + service role own those.
revoke insert, delete on public.profiles from authenticated, anon;

-- ── signup trigger ───────────────────────────────────────────────
-- Creates the profile row for every new auth user. Username comes from
-- signup metadata; invalid or taken usernames get a generated fallback so
-- signup never fails on a profile collision.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  raw text;
  candidate text;
begin
  raw := coalesce(new.raw_user_meta_data ->> 'username', '');
  if raw !~ '^[a-zA-Z0-9_]{3,20}$' then
    raw := 'baller_' || substr(md5(random()::text), 1, 6);
  end if;

  candidate := raw;
  -- On username collision, retry with random suffixes (trimmed to fit 20).
  while exists (select 1 from public.profiles where username = candidate) loop
    candidate := substr(raw, 1, 13) || '_' || substr(md5(random()::text), 1, 5);
  end loop;

  insert into public.profiles (id, username)
  values (new.id, candidate)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── topics ───────────────────────────────────────────────────────
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text not null default 'curated' check (source in ('curated', 'ai', 'user')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.topics enable row level security;

create policy "topics_select_authenticated"
  on public.topics for select to authenticated using (true);

-- Users can add their own topics ("bring your own beef").
create policy "topics_insert_own"
  on public.topics for insert to authenticated
  with check (created_by = auth.uid() and source = 'user');

-- ── debates ──────────────────────────────────────────────────────
create table public.debates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  topic_text text not null,
  mode text not null check (mode in ('text', 'speech')),
  opponent text not null default 'ai' check (opponent in ('ai', 'human')),
  user_side text,
  status text not null default 'created'
    check (status in ('created', 'arguing', 'transcribing', 'judging', 'complete', 'error')),
  -- rounds: [{ round: 'contention'|'rebuttal'|'summary', speaker: 'user'|'ai', text }]
  rounds jsonb not null default '[]'::jsonb,
  -- verdict: judge output JSON (scores, winner, judge's note, receipts)
  verdict jsonb,
  user_score smallint,
  opponent_score smallint,
  winner text check (winner in ('user', 'opponent', 'none')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index debates_user_created_idx on public.debates (user_id, created_at desc);

alter table public.debates enable row level security;

create policy "debates_select_own"
  on public.debates for select to authenticated using (user_id = auth.uid());

create policy "debates_insert_own"
  on public.debates for insert to authenticated with check (user_id = auth.uid());

-- Users may update their own debate while arguing, but scoring columns are
-- server-only (same column-grant pattern as profiles): tampering with verdict
-- or scores client-side must be impossible since points flow from them.
create policy "debates_update_own"
  on public.debates for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke update on public.debates from authenticated, anon;
grant update (rounds, user_side, status, updated_at) on public.debates to authenticated;

-- updated_at maintenance
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger debates_set_updated_at
  before update on public.debates
  for each row execute function public.set_updated_at();

-- ── weekly debate cap (Free 1/week · Pro 10/week) ────────────────
-- Unbypassable DB-level enforcement, same model as pitchcoachai's monthly cap.
-- Calendar week (Monday start, date_trunc). Error rows don't count against you.
create or replace function public.enforce_weekly_debate_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  week_count integer;
  cap integer;
begin
  select case when p.is_pro then 10 else 1 end into cap
  from public.profiles p where p.id = new.user_id;

  if cap is null then
    raise exception 'no profile for user %', new.user_id using errcode = 'check_violation';
  end if;

  select count(*) into week_count
  from public.debates d
  where d.user_id = new.user_id
    and d.created_at >= date_trunc('week', now())
    and d.status <> 'error';

  if week_count >= cap then
    raise exception 'weekly debate limit reached' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_weekly_debate_limit
  before insert on public.debates
  for each row execute function public.enforce_weekly_debate_limit();

-- ── badges ───────────────────────────────────────────────────────
create table public.badges (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null
);

create table public.user_badges (
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id uuid not null references public.badges(id) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

alter table public.badges enable row level security;
alter table public.user_badges enable row level security;

-- Badge catalog + who-earned-what are public within the app; awarding is
-- service-role-only (no insert policies).
create policy "badges_select_authenticated"
  on public.badges for select to authenticated using (true);

create policy "user_badges_select_authenticated"
  on public.user_badges for select to authenticated using (true);

-- Function EXECUTE hygiene (pitchcoachai gotcha: revoke from PUBLIC, not just
-- anon/authenticated, or the grant leaks through).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.enforce_weekly_debate_limit() from public, anon, authenticated;

-- ── grant tightening (applied as follow-up migration tighten_table_grants) ──
-- No RLS update/delete policies exist on these, but drop the default grants too
-- so a future permissive policy can't silently widen access.
revoke update, delete on public.topics from authenticated, anon;
revoke insert, update, delete on public.badges from authenticated, anon;
revoke insert, update, delete on public.user_badges from authenticated, anon;
revoke select on public.profiles, public.topics, public.debates, public.badges, public.user_badges from anon;
