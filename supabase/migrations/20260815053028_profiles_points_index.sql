-- Career rank on the dashboard needs `count(*) where points > mine`, and the
-- leaderboard has been running `order by points desc, wins desc limit 100`
-- since launch. Neither has ever had an index: there is no index on
-- profiles.points anywhere in the migration history, so both have been doing a
-- sequential scan plus a sort.
--
-- Harmless at today's user count and not harmless later, and it is one line, so
-- it lands before the dashboard starts issuing the rank query on every load.
--
-- (points desc, wins desc) matches the leaderboard's exact ordering so that
-- query is covered too, and the same index is scanned ascending for
-- "who is one rank above me".

create index if not exists profiles_points_desc_idx
  on public.profiles (points desc, wins desc);
