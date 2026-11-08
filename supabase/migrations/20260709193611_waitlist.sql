-- Pre-launch waitlist: public landing form captures emails.
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Anyone (anonymous visitors included) may add their own email.
-- No SELECT/UPDATE/DELETE policy for public roles, so the list is write-only
-- from the client (emails can't be read or enumerated by visitors).
drop policy if exists "anyone can join waitlist" on public.waitlist;
create policy "anyone can join waitlist"
  on public.waitlist
  for insert
  to anon, authenticated
  with check (true);
