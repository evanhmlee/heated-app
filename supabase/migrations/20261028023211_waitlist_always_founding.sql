-- Waitlist signups are always founders (founder decision 2026-10-27, with the
-- launch email to the waitlist).
--
-- Until now founding was only the first 100 real accounts. The waitlist email
-- promises founder status to everyone on the list, so an address in
-- public.waitlist is flagged founding whatever the count, and does not need a
-- slot. Everyone else keeps the old rule: founding while fewer than 100 real
-- founders exist. Test accounts (@heated.test) are still never founders.
--
-- Note the checkout coupon (heated_founding_30) has max_redemptions 100, so if
-- waitlist founders push redemptions past 100 the coupon must be raised in
-- Stripe; checkout reports it as 'broken' rather than charging silently.

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
      exists (
        select 1 from public.waitlist w
        where lower(trim(w.email)) = lower(trim(new.email))
      )
      or (
        select count(*)
        from public.profiles p
        join auth.users u on u.id = p.id
        where p.is_founding
          and coalesce(u.email, '') not ilike '%@heated.test'
      ) < 100
    );

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

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Backfill: any waitlist address that already has a non-founding account.
with promoted as (
  update public.profiles p
  set is_founding = true
  from auth.users u, public.waitlist w
  where u.id = p.id
    and lower(trim(w.email)) = lower(u.email)
    and not p.is_founding
    and coalesce(u.email, '') not ilike '%@heated.test'
  returning p.id
)
insert into public.user_badges (user_id, badge_id)
select promoted.id, b.id from promoted, public.badges b where b.slug = 'founding'
on conflict (user_id, badge_id) do nothing;
