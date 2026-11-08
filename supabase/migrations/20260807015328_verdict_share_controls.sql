-- Verdict share controls (2026-08-06)
--
-- Sharing in Heated is INSTANT, not opt-in: the debate UUID is the link, so a
-- finished verdict is shareable the moment it exists. That is deliberate — the
-- share happens at the one moment the user is actually hyped about the result,
-- and a "create a link" step in front of it kills the growth loop.
--
-- What was missing is the way back out. These three columns are the controls
-- the share sheet writes:
--   share_revoked  — the sharer took it down; /v/[id] and the card both 404.
--   share_receipts — publish the judge's receipts under the note, or just the note.
--   share_name     — publish the sharer's username, or post it anonymously.
--
-- Receipts default TRUE: they are the judge's reasoning about a debate whose
-- topic and scores are already public, they are the app's whole "brings
-- receipts" flavor, and a card with evidence on it is the one people actually
-- send. Nothing private lives in them (transcripts are never published).
--
-- All three are written ONLY by the service role via /api/debate/[id]/share.
-- debates already has table-level UPDATE revoked from authenticated with an
-- explicit column grant (rounds, user_side, status, updated_at), so new columns
-- are unwritable by a client automatically. The revoke/grant pair below
-- re-asserts that rather than relying on it.

alter table public.debates
  add column if not exists share_revoked  boolean not null default false,
  add column if not exists share_receipts boolean not null default true,
  add column if not exists share_name     boolean not null default true;

comment on column public.debates.share_revoked is
  'Sharer took the public verdict down. /v/[id] and the OG card both 404 when true.';
comment on column public.debates.share_receipts is
  'Publish the judge''s receipts on the public verdict page and card.';
comment on column public.debates.share_name is
  'Publish the sharer''s username. False renders the verdict anonymously.';

-- Least privilege, re-asserted. The share columns are absent from the grant, so
-- a client cannot un-revoke someone else's verdict or flip its visibility even
-- if the API route were bypassed.
revoke update on public.debates from authenticated, anon;
grant update (rounds, user_side, status, updated_at) on public.debates to authenticated;

-- Insert grant re-asserted for the same reason: the share columns must not be
-- settable at insert either, so a debate can never be born pre-revoked or with
-- someone else's visibility choices baked in.
revoke insert on public.debates from authenticated, anon;
grant insert (user_id, topic_id, topic_text, mode, opponent, user_side, status, difficulty, is_random, versus)
  on public.debates to authenticated;
