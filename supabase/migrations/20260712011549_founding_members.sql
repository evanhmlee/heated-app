-- Heated: founding members. The first 100 signups are permanent founding
-- members: a +20% boost on point GAINS (applied in the app's award routes,
-- lib/debate.ts applyFounding) and an automatic, un-loseable Founding Member
-- badge granted at signup.
-- Applied via Supabase MCP 2026-07-11. This file is the repo record.

-- ── profiles.is_founding (service-role only) ─────────────────────
-- Not added to the authenticated UPDATE column grant (which is username +
-- avatar_url only, see 20260704_auth_and_core_schema.sql), so it's already
-- locked to the signup trigger / service role. No grant change needed.
alter table public.profiles
  add column is_founding boolean not null default false;

-- ── founding badge ───────────────────────────────────────────────
-- Keep in sync with lib/badges.ts BADGES.
insert into public.badges (slug, name, description) values
  ('founding', 'Founding Member', 'One of the first 100 on Heated. Permanent 20 percent points boost.')
on conflict (slug) do nothing;

-- ── signup trigger: auto-flag + auto-badge the first 100 ─────────
-- Extends handle_new_user: the first 100 profiles are flagged is_founding and
-- immediately granted the founding badge (not tied to any debate result). The
-- count(*) gate is approximate under heavy concurrent signup, which is fine
-- pre-launch; a slight overshoot past 100 is acceptable.
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
  -- On username collision, retry with random suffixes (trimmed to fit 20).
  while exists (select 1 from public.profiles where username = candidate) loop
    candidate := substr(raw, 1, 13) || '_' || substr(md5(random()::text), 1, 5);
  end loop;

  -- First 100 accounts are founding members.
  founding := (select count(*) from public.profiles) < 100;

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

-- CREATE OR REPLACE FUNCTION preserves the existing trigger binding and ACL,
-- but re-assert the least-privilege revoke as defense in depth.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ── backfill: existing pre-launch users are founding ─────────────
-- They're all early adopters; cap at the earliest 100 by created_at to honor
-- the "first 100" rule precisely.
with early as (
  select id from public.profiles order by created_at asc limit 100
)
update public.profiles p
  set is_founding = true
  from early
  where p.id = early.id;

-- Grant the founding badge to every founding member missing it.
insert into public.user_badges (user_id, badge_id)
select p.id, b.id
  from public.profiles p
  cross join public.badges b
  where p.is_founding = true
    and b.slug = 'founding'
on conflict (user_id, badge_id) do nothing;
