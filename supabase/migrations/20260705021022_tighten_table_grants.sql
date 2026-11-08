-- Defense-in-depth: no RLS update/delete policies exist on these, but drop the
-- default grants too so a future permissive policy can't silently widen access.
revoke update, delete on public.topics from authenticated, anon;
revoke insert, update, delete on public.badges from authenticated, anon;
revoke insert, update, delete on public.user_badges from authenticated, anon;
revoke insert, update, delete on public.badges, public.user_badges, public.topics from anon;
revoke select on public.profiles, public.topics, public.debates, public.badges, public.user_badges from anon;
