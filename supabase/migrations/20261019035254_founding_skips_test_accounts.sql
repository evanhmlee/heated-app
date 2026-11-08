-- Test accounts no longer take founding slots (launch checklist item 10).
--
-- Founding status is the first 100 accounts: 30% off every purchase forever
-- (checkout attaches the coupon for is_founding) plus the badge. Until now the
-- trigger counted EVERY profile, so each throwaway account made for filming or
-- a production smoke test (demo-marcus@heated.test and friends) burned a slot a
-- real customer would have had, and handed a test account a founder discount.
--
-- Two changes, both scoped to addresses at the reserved test domain:
--   1. a test signup is never flagged founding, and
--   2. the 100 is counted over FOUNDING profiles that are not test accounts,
--      so test accounts already flagged before this migration stop counting too.
-- Counting founders rather than all profiles is the same rule as before for a
-- real signup (the first 100 real accounts are founders), just stated directly.
--
-- Test accounts belong at @heated.test. That domain cannot receive mail, so
-- these accounts are only ever created confirmed via the admin API or SQL.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  raw text;
  candidate text;
  founding boolean;
  founding_badge_id uuid;
begin
  raw := coalesce(new.raw_user_meta_data ->> 'username', '');
  if raw !~ '^[a-zA-Z0-9_]{3,20}$' then
    raw := 'baller_' || substr(md5(random()::text), 1, 6);
  end if;

  candidate := raw;
  while exists (select 1 from public.profiles where username = candidate) loop
    candidate := substr(raw, 1, 13) || '_' || substr(md5(random()::text), 1, 5);
  end loop;

  founding := coalesce(new.email, '') not ilike '%@heated.test'
    and (
      select count(*)
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.is_founding
        and coalesce(u.email, '') not ilike '%@heated.test'
    ) < 100;

  insert into public.profiles (id, username, is_founding)
  values (new.id, candidate, founding)
  on conflict (id) do nothing;

  if founding then
    select id into founding_badge_id from public.badges where slug = 'founding';
    if founding_badge_id is not null then
      insert into public.user_badges (user_id, badge_id)
      values (new.id, founding_badge_id)
      on conflict (user_id, badge_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

-- CREATE OR REPLACE keeps the trigger binding and ACL; re-assert the revoke
-- anyway, naming anon explicitly (Supabase grants EXECUTE to anon directly).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
