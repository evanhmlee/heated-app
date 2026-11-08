-- Ticket economy: replaces the weekly debate cap with a trickle-refilling
-- allowance, so the app can sell what the landing page actually promises.
--
-- WHY THIS REPLACES THE WEEKLY CAP
-- The old model counted debates inside a calendar week (Free 1, Pro 10). One a
-- week means nobody can rematch, build a streak, or form a rivalry, and it
-- produces roughly four shareable verdict cards a month. The share card is the
-- only distribution this app has, so a cap that throttles it throttles growth.
--
-- THE MODEL, and it matches app/page.tsx word for word:
--   Free  1 ticket every 48h, bank up to 5   ("one free debate every 2 days")
--   Pro   1 ticket every 4.8h (5/day), bank up to 50  ("5 debates a day")
-- Tickets accrue continuously rather than resetting on a clock, which is what
-- makes "save up unused debates for a big week" true. There is no cron: accrual
-- is a pure function of (tickets_updated_at, now, rate, cap) evaluated lazily
-- whenever the balance is read or spent, so a dead scheduler cannot strand
-- anyone at zero.
--
-- FLAT PRICING: every mode costs exactly 1 ticket (founder decision 2026-08-10).
-- Online ranked genuinely costs ~4x a text debate in API spend, but a currency
-- with per-mode prices needs a visitor to learn a noun before they can read the
-- pricing card, and the landing sells "debates". The exposure is bounded by the
-- low free rate: a free user who spends every ticket on ranked video still only
-- gets one every two days.
--
-- Applied via Supabase MCP. This file is the repo record.

-- ── profiles: the wallet ──────────────────────────────────────────
-- NEW_USER_TICKETS is 3, not the full bank of 5 and not 1. A new account has to
-- be able to finish a debate immediately (the second-debate rate is the kill
-- criterion for this whole model), and 3 covers vs-AI, a pass-the-phone game
-- with whoever is nearby, and one more, without handing a scripted signup a
-- full bank.
alter table public.profiles
  add column if not exists tickets integer not null default 3
    check (tickets >= 0),
  add column if not exists tickets_updated_at timestamptz not null default now(),
  -- Bought in packs, never expire, never accrue, and deliberately spent AFTER
  -- the free allowance so a pack lasts as long as possible. Also the flag for
  -- "packs come with Pro turned on": see public.is_effective_pro below.
  add column if not exists purchased_tickets integer not null default 0
    check (purchased_tickets >= 0);

-- Existing accounts pick up the column defaults (3 tickets, clock starting at
-- ALTER time), which is the right migration: nobody loses a debate they had,
-- and the first accrual lands 48h later like everyone else's.

-- Still no client writes to any of this (the 2026-06-30 PitchCoach audit:
-- a blanket UPDATE grant let users flip is_pro on themselves). The grant list
-- stays username + avatar_url; tickets move only through the functions below,
-- all of which are security definer.

-- ── debates: which pool paid ──────────────────────────────────────
-- Recorded per seat so a void can refund the pool it actually took from.
-- Without this, a user whose ranked match dies on a disconnect gets an
-- allowance ticket back for a ticket they paid a dollar for.
alter table public.debates
  add column if not exists ticket_source text
    check (ticket_source in ('allowance', 'purchased')),
  add column if not exists opponent_ticket_source text
    check (opponent_ticket_source in ('allowance', 'purchased')),
  add column if not exists tickets_refunded boolean not null default false;

-- ── the rate table ────────────────────────────────────────────────
-- One place, so the trigger, the balance reader and the UI cannot disagree.
create or replace function public.ticket_rate(p_is_pro boolean)
returns table (bank_cap integer, refill_seconds integer)
language sql
immutable
-- Pinned like every other function here. Not security definer, so the blast
-- radius is small, but advisor 0011 flags it and an unpinned search_path is a
-- foothold worth not leaving.
set search_path = public
as $$
  select
    case when p_is_pro then 50 else 5 end,
    -- 4.8h = 5 a day. Free is a flat 48h.
    case when p_is_pro then 17280 else 172800 end;
$$;

-- ── accrual ───────────────────────────────────────────────────────
-- Brings a wallet up to date and returns the fresh balance. Writes, so it is
-- NOT for rendering: the UI reads through public.ticket_balance() below.
--
-- The clock advances by exactly gained * refill_seconds rather than to now(),
-- so the fraction of an interval already earned is never thrown away. A user
-- sitting at the bank cap keeps accruing into the discard, which is correct:
-- their clock ends up within one interval of now, so spending from a full bank
-- does not hand them an instant refill.
create or replace function public.accrue_tickets(p_user uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  prof record;
  cap integer;
  refill integer;
  gained integer;
begin
  select id, is_pro, tickets, tickets_updated_at
    into prof
  from public.profiles
  where id = p_user
  for update;

  if not found then
    return null;
  end if;

  select bank_cap, refill_seconds into cap, refill
  from public.ticket_rate(prof.is_pro);

  gained := floor(
    extract(epoch from (now() - prof.tickets_updated_at)) / refill
  )::integer;

  if gained > 0 then
    update public.profiles
    set tickets = least(cap, prof.tickets + gained),
        tickets_updated_at = prof.tickets_updated_at
          + (gained * refill) * interval '1 second'
    where id = p_user
    returning tickets into gained;
    return gained;
  end if;

  return prof.tickets;
end;
$$;

-- ── the balance reader ────────────────────────────────────────────
-- What the header and the out-of-tickets screen render. Accrues first (so the
-- number is never stale by up to two days) and hands back everything the UI
-- needs, including when the next ticket lands, so the client never has to
-- reimplement the rate table.
create or replace function public.ticket_balance()
returns table (
  tickets integer,
  purchased integer,
  bank_cap integer,
  refill_seconds integer,
  next_ticket_at timestamptz,
  is_pro boolean
)
language plpgsql
security definer set search_path = public
as $$
-- The RETURNS TABLE column names (tickets, bank_cap, is_pro...) are also
-- plpgsql variables, and the query below selects columns with those exact
-- names. Without this, every one of them is an ambiguous reference at runtime.
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  current_tickets integer;
begin
  if uid is null then
    return;
  end if;

  current_tickets := public.accrue_tickets(uid);
  if current_tickets is null then
    return;
  end if;

  return query
  select
    p.tickets,
    p.purchased_tickets,
    r.bank_cap,
    r.refill_seconds,
    -- Null at the bank cap: nothing is coming, you already have everything.
    case
      when p.tickets >= r.bank_cap then null
      else p.tickets_updated_at + r.refill_seconds * interval '1 second'
    end,
    p.is_pro
  from public.profiles p
  cross join lateral public.ticket_rate(p.is_pro) r
  where p.id = uid;
end;
$$;

-- ── effective Pro ─────────────────────────────────────────────────
-- The landing sells packs as "no subscription, and they come with Pro turned
-- on", so holding pack tickets unlocks the Pro perks (custom topics, Deep Dive,
-- re-roll) for as long as they last. Subscription state is untouched: is_pro
-- still means a paying subscriber, which is what the ticket rate keys on.
create or replace function public.is_effective_pro(p_user uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select is_pro or purchased_tickets > 0
     from public.profiles where id = p_user),
    false
  );
$$;

-- ── spending: the unbypassable layer ──────────────────────────────
-- Replaces enforce_weekly_debate_limit. Keeps everything that trigger got
-- right: it runs BEFORE INSERT so no client can route around it, and it charges
-- BOTH seats of an online match (each consumed a judged debate, and it
-- rate-limits alt-account point farming).
--
-- Allowance is spent before purchased tickets, and which pool paid is stamped
-- on the row so a void can refund correctly.
create or replace function public.enforce_ticket_spend()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  parties uuid[];
  uid uuid;
  balance integer;
  purchased integer;
  source text;
begin
  parties := array[new.user_id];
  if new.opponent_user_id is not null and new.opponent_user_id <> new.user_id then
    parties := parties || new.opponent_user_id;
  end if;

  foreach uid in array parties loop
    balance := public.accrue_tickets(uid);

    if balance is null then
      raise exception 'no profile for user %', uid using errcode = 'check_violation';
    end if;

    if balance > 0 then
      update public.profiles set tickets = tickets - 1 where id = uid;
      source := 'allowance';
    else
      select purchased_tickets into purchased
      from public.profiles where id = uid;

      if coalesce(purchased, 0) < 1 then
        -- Client code matches on the 'out of tickets' substring; the suffix
        -- tells the lobby accept route WHICH seat is empty.
        raise exception 'out of tickets: %',
          case when uid = new.user_id then 'host' else 'challenger' end
          using errcode = 'check_violation';
      end if;

      update public.profiles
      set purchased_tickets = purchased_tickets - 1
      where id = uid;
      source := 'purchased';
    end if;

    if uid = new.user_id then
      new.ticket_source := source;
    else
      new.opponent_ticket_source := source;
    end if;
  end loop;

  return new;
end;
$$;

-- Exactly one trigger on this function. The old cap trigger was a pure check,
-- so a duplicate binding was harmless; spending is a side effect, and PitchCoach
-- shipped precisely this bug (two triggers on one credit-decrementing function,
-- double-charging every insert). Drop both possible names before creating.
drop trigger if exists enforce_weekly_debate_limit on public.debates;
drop trigger if exists trg_enforce_weekly_debate_limit on public.debates;
drop trigger if exists enforce_ticket_spend on public.debates;

create trigger enforce_ticket_spend
  before insert on public.debates
  for each row execute function public.enforce_ticket_spend();

drop function if exists public.enforce_weekly_debate_limit();

-- ── refunds ───────────────────────────────────────────────────────
-- The old model refunded by EXCLUSION: voided and errored rows simply were not
-- counted. A spend model has to hand the ticket back explicitly, or an online
-- match that dies on a disconnect quietly costs both players a debate.
--
-- Refunds return the ticket to the pool that paid, and are capped at the bank
-- so a refund can never push a wallet above its ceiling. `tickets_refunded`
-- makes this idempotent: the abandon route can be called repeatedly, and a row
-- that goes void -> error must not pay out twice.
create or replace function public.refund_ticket(p_user uuid, p_source text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  cap integer;
begin
  if p_user is null or p_source is null then
    return;
  end if;

  if p_source = 'purchased' then
    update public.profiles
    set purchased_tickets = purchased_tickets + 1
    where id = p_user;
  else
    select r.bank_cap into cap
    from public.profiles p
    cross join lateral public.ticket_rate(p.is_pro) r
    where p.id = p_user;

    update public.profiles
    set tickets = least(coalesce(cap, 5), tickets + 1)
    where id = p_user;
  end if;
end;
$$;

create or replace function public.refund_dead_debate()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status in ('void', 'error')
     and old.status not in ('void', 'error')
     and not old.tickets_refunded then
    perform public.refund_ticket(new.user_id, new.ticket_source);
    if new.opponent_user_id is not null
       and new.opponent_user_id <> new.user_id then
      perform public.refund_ticket(new.opponent_user_id, new.opponent_ticket_source);
    end if;
    new.tickets_refunded := true;
  end if;
  return new;
end;
$$;

drop trigger if exists refund_dead_debate on public.debates;

create trigger refund_dead_debate
  before update of status on public.debates
  for each row execute function public.refund_dead_debate();

-- ── pack fulfilment ───────────────────────────────────────────────
-- Called by the Stripe webhook with the service role. Never callable from a
-- client: PitchCoach's audit found an add_session_credits RPC that authenticated
-- users could invoke to mint themselves free sessions.
create or replace function public.add_purchased_tickets(p_user uuid, p_qty integer)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  updated integer;
begin
  if p_qty is null or p_qty < 1 or p_qty > 200 then
    raise exception 'bad ticket quantity %', p_qty using errcode = 'check_violation';
  end if;

  update public.profiles
  set purchased_tickets = purchased_tickets + p_qty
  where id = p_user
  returning purchased_tickets into updated;

  return updated;
end;
$$;

-- ── grants ────────────────────────────────────────────────────────
-- Supabase's default privileges hand function EXECUTE to anon directly, so
-- revoking from PUBLIC alone leaves anon able to call (advisor 0028). Every
-- one of these must be revoked from anon explicitly.
revoke execute on function public.ticket_rate(boolean) from public, anon, authenticated;
revoke execute on function public.accrue_tickets(uuid) from public, anon, authenticated;
revoke execute on function public.ticket_balance() from public, anon, authenticated;
revoke execute on function public.is_effective_pro(uuid) from public, anon, authenticated;
revoke execute on function public.enforce_ticket_spend() from public, anon, authenticated;
revoke execute on function public.refund_ticket(uuid, text) from public, anon, authenticated;
revoke execute on function public.refund_dead_debate() from public, anon, authenticated;
revoke execute on function public.add_purchased_tickets(uuid, integer) from public, anon, authenticated;

-- Only the balance reader is client-callable, and it is internally scoped to
-- auth.uid() with no parameters, so there is nothing to point at another user.
-- accrue_tickets and add_purchased_tickets stay service-role-only: the first
-- writes, the second mints paid inventory.
grant execute on function public.ticket_balance() to authenticated;
