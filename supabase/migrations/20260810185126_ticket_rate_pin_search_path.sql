-- Advisor 0011: ticket_rate shipped without a pinned search_path. It is not
-- security definer so the blast radius is small, but every other function in
-- this schema pins it and an unpinned one is a foothold worth not leaving.
create or replace function public.ticket_rate(p_is_pro boolean)
returns table (bank_cap integer, refill_seconds integer)
language sql
immutable
set search_path = public
as $$
  select
    case when p_is_pro then 50 else 5 end,
    case when p_is_pro then 17280 else 172800 end;
$$;

revoke execute on function public.ticket_rate(boolean) from public, anon, authenticated;
