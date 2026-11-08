-- Free tier: one debate a week, banking three.
--
-- Was 1 per 48h banking 5, which accrues ~15 debates a month. An engaged free
-- user wants 3 to 5, because a debate is effortful, so the wall never bound:
-- cap_hit stayed near zero and the paywall was decorative. A meter set above
-- the ceiling of demand is the same as no meter.
--
-- This puts the rate just under real appetite (~4.3 a month) so an engaged
-- user meets it a couple of times a month and has a reason to buy a pack.
--
-- The signup grant is profiles.tickets default 3 and is deliberately NOT
-- changed: it now equals the bank cap, so a new account starts full and the
-- first week is clean. Do not raise the grant above the cap. accrue_tickets()
-- only clamps on a tick (`if gained > 0`) while the lib/tickets.ts mirror
-- clamps on every read, so a balance above cap shows wrong in the UI and is
-- then silently eaten by the first accrual.
--
-- lib/tickets.ts carries a hand-maintained mirror of this table. The two are
-- asserted against each other by nothing but a comment, so they move together
-- or the UI promises a refill the database will not honour.
--
-- Pro is unchanged: 1 per 4.8h (5 a day), banking 50.

create or replace function public.ticket_rate(p_is_pro boolean)
returns table (bank_cap integer, refill_seconds integer)
language sql
immutable
-- Pinned like every other function here (advisor 0011).
set search_path = public
as $$
  select
    case when p_is_pro then 50 else 3 end,
    -- 4.8h = 5 a day on Pro. Free is a flat 7 days.
    case when p_is_pro then 17280 else 604800 end;
$$;

-- create or replace preserves grants, but this is re-stated because Supabase
-- default privileges grant EXECUTE to anon directly, and revoking from public
-- alone leaves anon able to call (advisor 0028).
revoke execute on function public.ticket_rate(boolean) from public, anon, authenticated;
