-- Advisor 0011: pin the search_path on the shared updated_at trigger fn
-- (now backs both debates and lobbies).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
