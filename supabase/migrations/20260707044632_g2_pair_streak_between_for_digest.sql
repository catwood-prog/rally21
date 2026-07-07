-- G2 digest support: compose-digest runs as service_role (no auth.uid()),
-- iterating many users' pairs, and needs the streak "as of yesterday" vs
-- "as of today" to detect a milestone crossing — get_pair_streaks() can't
-- be reused directly since it's keyed off the calling user's auth.uid().
-- Same underlying rule (glow_qualifying_days intersection), parameterized
-- by two explicit user ids and an explicit through-date instead.
create or replace function public.get_pair_streak_between(p_user1 uuid, p_user2 uuid, p_through date)
returns int
language sql
security definer
set search_path = public
as $$
  with u1_days as (
    select d from public.glow_qualifying_days(p_user1, p_through) where qualifies
  ),
  u2_days as (
    select d from public.glow_qualifying_days(p_user2, p_through) where qualifies
  ),
  both_days as (
    select d from u1_days intersect select d from u2_days
  ),
  islands as (
    select d, d - (row_number() over (order by d))::int as grp from both_days
  ),
  last_island as (
    select grp from islands order by d desc limit 1
  )
  select case
    when (select max(d) from both_days) >= p_through - 1
      then coalesce((select count(*)::int from islands where grp = (select grp from last_island)), 0)
    else 0
  end;
$$;
revoke all on function public.get_pair_streak_between(uuid, uuid, date) from anon, public, authenticated;
grant execute on function public.get_pair_streak_between(uuid, uuid, date) to service_role;
