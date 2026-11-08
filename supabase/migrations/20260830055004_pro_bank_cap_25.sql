-- Pro bank cap: 50 down to 25.
--
-- This limits HOARDING, not throughput. Pro still accrues 1 per 4.8h (5 a day,
-- ~150 a month); refill_seconds is what governs volume and it is unchanged. The
-- cap only decides how much a subscriber who has been away comes back to.
--
-- One live Pro account is holding 50 and will be clamped to 25 at its next
-- accrual tick. accrue_tickets() clamps only when gained > 0, while the
-- lib/tickets.ts mirror clamps on every read, so that account shows 25
-- immediately and the row catches up within 4.8h.
--
-- Free is unchanged: 3, refilling every 7 days.
--
-- lib/tickets.ts mirrors this table. scripts/check-ticket-rate.mjs asserts the
-- two against each other and exits non-zero on drift.

create or replace function public.ticket_rate(p_is_pro boolean)
returns table (bank_cap integer, refill_seconds integer)
language sql
immutable
set search_path = public
as $$
  select
    case when p_is_pro then 25 else 3 end,
    -- 4.8h = 5 a day on Pro. Free is a flat 7 days.
    case when p_is_pro then 17280 else 604800 end;
$$;

revoke execute on function public.ticket_rate(boolean) from public, anon, authenticated;
