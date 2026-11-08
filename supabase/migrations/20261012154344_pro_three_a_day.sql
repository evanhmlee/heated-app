-- Pro: 5 tickets a day down to 3 (founder call 2026-10-12, before the
-- Oct 20 launch). One ticket per 8h. The bank cap stays 25: it limits
-- hoarding, not throughput.
--
-- lib/tickets.ts mirrors this table; scripts/check-ticket-rate.mjs asserts
-- the two against each other.

create or replace function public.ticket_rate(p_is_pro boolean)
returns table (bank_cap integer, refill_seconds integer)
language sql
immutable
set search_path = public
as $$
  select
    case when p_is_pro then 25 else 3 end,
    -- 8h = 3 a day on Pro. Free is a flat 7 days.
    case when p_is_pro then 28800 else 604800 end;
$$;

revoke execute on function public.ticket_rate(boolean) from public, anon, authenticated;
