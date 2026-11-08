-- Online ranked Human vs Human debates (2026-07-11).
--
-- Two accounts, remote, live video call (Daily.co), ranked: winner +150 flat,
-- loser -25, founding boost on gains, 10% rematch decay per repeat win vs the
-- same opponent within a calendar week. Matches form through lobbies: the host
-- creates one (listed on the live board or unlisted/code-only), challengers
-- request to join, the host accepts one. Both players burn a weekly cap slot;
-- a voided match (early disconnect) refunds both.
--
-- Applied via Supabase MCP. This file is the repo record.

-- ── profiles: separate H2H record ─────────────────────────────────
-- Online ranked results ALSO move the main wins/losses/streaks (full parity,
-- founder decision 2026-07-11); these columns are the additional H2H-only
-- ledger shown on the profile. Service-role-only writes: the authenticated
-- UPDATE grant is column-scoped to username/avatar_url and stays that way.
alter table public.profiles
  add column if not exists h2h_wins integer not null default 0,
  add column if not exists h2h_losses integer not null default 0;

-- ── debates: the second seat + the void status ────────────────────
-- opponent_user_id is the ranked-online marker: it can ONLY be set by the
-- service-role accept route (it is deliberately NOT in the client INSERT
-- grant), so a client can never forge a ranked match or a fake opponent.
alter table public.debates
  add column if not exists opponent_user_id uuid references public.profiles(id) on delete set null;

create index if not exists debates_opponent_created_idx
  on public.debates (opponent_user_id, created_at desc)
  where opponent_user_id is not null;

-- 'void' = an online match abandoned before the rebuttal section: nobody wins,
-- and (like 'error') it does not count against either player's weekly cap.
alter table public.debates drop constraint if exists debates_status_check;
alter table public.debates add constraint debates_status_check
  check (status in ('created', 'arguing', 'transcribing', 'judging', 'complete', 'error', 'void'));

-- The opponent can read the shared debate row (arena + verdict). Writes stay
-- owner-only: online round submissions go through the service role after the
-- server verifies the caller matches the derived speaker.
drop policy if exists "debates_select_own" on public.debates;
create policy "debates_select_own_or_opponent"
  on public.debates for select to authenticated
  using (user_id = auth.uid() or opponent_user_id = auth.uid());

-- ── weekly cap trigger: enforce BOTH seats, exclude void ──────────
-- An online debate counts against host AND challenger (each consumed a judged
-- debate, and it rate-limits alt-account point farming). The service-role
-- insert in the accept route fires this trigger like any other insert.
create or replace function public.enforce_weekly_debate_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  parties uuid[];
  uid uuid;
  week_count integer;
  cap integer;
begin
  parties := array[new.user_id];
  if new.opponent_user_id is not null and new.opponent_user_id <> new.user_id then
    parties := parties || new.opponent_user_id;
  end if;

  foreach uid in array parties loop
    select case when p.is_pro then 10 else 1 end into cap
    from public.profiles p where p.id = uid;

    if cap is null then
      raise exception 'no profile for user %', uid using errcode = 'check_violation';
    end if;

    select count(*) into week_count
    from public.debates d
    where (d.user_id = uid or d.opponent_user_id = uid)
      and d.created_at >= date_trunc('week', now())
      and d.status not in ('error', 'void');

    if week_count >= cap then
      -- Client code matches on the 'weekly debate limit' substring; the suffix
      -- lets the accept route tell WHICH seat is out of debates.
      raise exception 'weekly debate limit reached: %',
        case when uid = new.user_id then 'host' else 'challenger' end
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end;
$$;

-- ── lobbies ───────────────────────────────────────────────────────
create table public.lobbies (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  code text not null unique,
  is_listed boolean not null default true,
  topic_source text not null check (topic_source in ('random', 'custom')),
  -- Custom lobbies carry the full matchup up front (the challenger sees the
  -- topic AND their side before requesting). Random lobbies carry nothing:
  -- the topic is generated at accept time and revealed at tip-off, sides
  -- coin-flipped.
  topic_text text,
  host_side text,
  guest_side text,
  difficulty text not null default 'starter'
    check (difficulty in ('rookie', 'starter', 'all_star', 'hall_of_famer')),
  turn_seconds integer not null default 120 check (turn_seconds in (60, 90, 120)),
  status text not null default 'open' check (status in ('open', 'matched', 'cancelled')),
  accepted_user_id uuid references public.profiles(id) on delete set null,
  debate_id uuid references public.debates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lobbies_custom_fields check (
    topic_source = 'random'
    or (topic_text is not null and host_side is not null and guest_side is not null)
  )
);

-- One open lobby per host (keeps the live board clean, blocks lobby spam) +
-- a fast path for the live board query.
create unique index lobbies_one_open_per_host on public.lobbies (host_id) where status = 'open';
create index lobbies_open_listed_idx on public.lobbies (created_at desc) where status = 'open' and is_listed;

create trigger lobbies_set_updated_at
  before update on public.lobbies
  for each row execute function public.set_updated_at();

-- ── lobby requests ────────────────────────────────────────────────
create table public.lobby_requests (
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (lobby_id, requester_id)
);

-- ── RLS helper fns (definer, to break lobbies<->lobby_requests recursion —
-- same lesson as pitchcoach's is_team_owner) ────────────────────────
create or replace function public.is_lobby_host(l_id uuid)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (select 1 from public.lobbies where id = l_id and host_id = auth.uid());
$$;

create or replace function public.has_lobby_request(l_id uuid)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (select 1 from public.lobby_requests where lobby_id = l_id and requester_id = auth.uid());
$$;

-- Function EXECUTE hygiene (revoke from PUBLIC, not just anon — supabase
-- default privileges gotcha).
revoke execute on function public.is_lobby_host(uuid) from public, anon;
revoke execute on function public.has_lobby_request(uuid) from public, anon;
grant execute on function public.is_lobby_host(uuid) to authenticated;
grant execute on function public.has_lobby_request(uuid) to authenticated;

-- ── RLS: lobbies ──────────────────────────────────────────────────
alter table public.lobbies enable row level security;

-- Listed lobbies are the public live board. Unlisted lobbies are visible only
-- to the host, their requesters, and the accepted challenger — join-by-code
-- lookups go through the service-role route, so codes stay unenumerable.
create policy "lobbies_select"
  on public.lobbies for select to authenticated
  using (
    is_listed
    or host_id = auth.uid()
    or accepted_user_id = auth.uid()
    or public.has_lobby_request(id)
  );

create policy "lobbies_insert_own"
  on public.lobbies for insert to authenticated
  with check (host_id = auth.uid());

create policy "lobbies_update_own"
  on public.lobbies for update to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());

-- Column lockdown: the host creates the lobby config and may cancel it, but
-- matching (status='matched', accepted_user_id, debate_id) is service-role-only.
revoke select, insert, update, delete on public.lobbies from authenticated, anon;
grant select on public.lobbies to authenticated;
grant insert (host_id, code, is_listed, topic_source, topic_text, host_side, guest_side, difficulty, turn_seconds)
  on public.lobbies to authenticated;
grant update (status, updated_at) on public.lobbies to authenticated;

-- ── RLS: lobby_requests ───────────────────────────────────────────
alter table public.lobby_requests enable row level security;

-- Requesters see their own requests; the host sees the queue.
create policy "lobby_requests_select"
  on public.lobby_requests for select to authenticated
  using (requester_id = auth.uid() or public.is_lobby_host(lobby_id));

-- Host declines by flipping status; a requester withdraws by deleting their
-- own row. NO client INSERT policy or grant: joins go only through the
-- service-role /api/lobby/join route (same pattern as pitchcoach team joins).
create policy "lobby_requests_update_host"
  on public.lobby_requests for update to authenticated
  using (public.is_lobby_host(lobby_id)) with check (public.is_lobby_host(lobby_id));

create policy "lobby_requests_delete_own"
  on public.lobby_requests for delete to authenticated
  using (requester_id = auth.uid());

revoke select, insert, update, delete on public.lobby_requests from authenticated, anon;
grant select on public.lobby_requests to authenticated;
grant update (status) on public.lobby_requests to authenticated;
grant delete on public.lobby_requests to authenticated;

-- ── addendum (applied as migration online_h2h_guest_points) ───────
-- Persist the challenger's point delta alongside the host's, so either seat
-- can render both deltas after a refresh. Service-role-only like the other
-- scoring columns (not in any client grant).
alter table public.debates
  add column if not exists opponent_points_earned integer;
