-- Stripe webhook idempotency.
--
-- Stripe delivers events at least once, and a retried checkout.session.completed
-- for a pack would call add_purchased_tickets a second time and hand out ten
-- free debates. The webhook checks this table before doing work and writes the
-- row only after the work succeeds, so a genuine failure still gets retried.
--
-- Service role only. There is no policy and no grant: the webhook runs with the
-- service role, which bypasses RLS, and nothing else has any business here.
-- Applied via Supabase MCP. This file is the repo record.

create table if not exists public.processed_stripe_events (
  event_id text primary key,
  processed_at timestamptz not null default now()
);

alter table public.processed_stripe_events enable row level security;

revoke all on public.processed_stripe_events from authenticated, anon;

-- Housekeeping: Stripe stops retrying after about three days, so anything older
-- than a month is dead weight. Not scheduled; run it by hand if the table ever
-- gets big enough to notice.
--   delete from public.processed_stripe_events where processed_at < now() - interval '30 days';
