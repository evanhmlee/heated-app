-- The Deep Dive's prose moves out of debates.verdict.
--
-- Both seats can SELECT their debate row, so any prose in debates.verdict was
-- readable by a free player straight from the browser, whatever the routes
-- stripped (the ranked arena reads the row directly). The prose now lives
-- here: RLS on, no policies, no grants to anon/authenticated. Only the
-- service role reads it (lib/deep-dive.ts), and only for an effective-Pro
-- caller. debates.verdict keeps each entry's round and swing for the locked
-- teaser, with "verdict" blanked.

create table if not exists public.debate_deep_dives (
  debate_id uuid primary key references public.debates(id) on delete cascade,
  entries jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.debate_deep_dives enable row level security;
revoke all on public.debate_deep_dives from public, anon, authenticated;

-- Move any prose already stored, then blank it in the row. Triggers off so
-- the backfill does not bump updated_at on old debates.
insert into public.debate_deep_dives (debate_id, entries)
select id, verdict->'deep_dive'
from public.debates
where jsonb_typeof(verdict->'deep_dive') = 'array'
  and exists (
    select 1 from jsonb_array_elements(verdict->'deep_dive') e
    where coalesce(e->>'verdict', '') <> ''
  )
on conflict (debate_id) do nothing;

set local session_replication_role = replica;
update public.debates
set verdict = jsonb_set(
  verdict,
  '{deep_dive}',
  (select coalesce(jsonb_agg(e || '{"verdict": ""}'::jsonb), '[]'::jsonb)
   from jsonb_array_elements(verdict->'deep_dive') e)
)
where jsonb_typeof(verdict->'deep_dive') = 'array';
