-- count(*) returns bigint; the function's declared streak column is
-- int, causing a "structure of query does not match" error found
-- during live verification. Cast explicitly.
create or replace function public.get_pair_streaks(p_circle_id uuid)
returns table(other_user_id uuid, other_name text, streak int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if not is_member_of_circle(p_circle_id) then
    raise exception 'not a member of this circle';
  end if;

  return query
  with pairs as (
    select m.user_id as other_id, u.name as other_name
    from public.memberships m
    join public.users u on u.id = m.user_id
    where m.circle_id = p_circle_id and m.user_id <> v_me
  ),
  my_days as (
    select gd.d from public.glow_qualifying_days(v_me, current_date) gd where gd.qualifies
  )
  select p.other_id, p.other_name, coalesce(s.streak, 0)::int
  from pairs p
  left join lateral (
    with both_days as (
      select od.d
      from public.glow_qualifying_days(p.other_id, current_date) od
      join my_days md on md.d = od.d
      where od.qualifies
    ),
    islands as (
      select d, d - (row_number() over (order by d))::int as grp
      from both_days
    ),
    last_island as (
      select grp from islands order by d desc limit 1
    )
    select
      case when (select max(d) from both_days) >= current_date - 1
        then (select count(*) from islands where grp = (select grp from last_island))
        else 0
      end as streak
  ) s on true;
end;
$$;
revoke all on function public.get_pair_streaks(uuid) from anon, public;
grant execute on function public.get_pair_streaks(uuid) to authenticated;
