-- G2: friend/pair streaks (Rally21-Glow-Spec.md §3, §6). App-level, not
-- circle-level: a pair streak is consecutive days BOTH users' own days
-- counted toward THEIR OWN glow (self or held-by-cover, one rulebook —
-- no separate cover logic). The shared circle is only how the pair
-- forms; the streak spans all circles and survives the circle completing.

-- Internal-only helper (not granted to authenticated/anon — would leak
-- any user's day-level activity pattern to any caller otherwise). Reuses
-- get_my_glow's day-qualification rule (self OR held-within-monthly-
-- capacity) without its ember/break bookkeeping, since a pair streak has
-- no ember grace of its own — just today-or-yesterday, per spec.
create or replace function public.glow_qualifying_days(p_user uuid, p_through date)
returns table(d date, qualifies boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_glow_ever int;
  v_capacity int;
  v_start date;
  v_cursor date;
  v_month_key text := null;
  v_holds_this_month int := 0;
  v_is_self boolean;
  v_is_covered boolean;
  v_q boolean;
begin
  select coalesce(max(self_count), 0) into v_max_glow_ever
  from (
    select grp_key, count(*) filter (where is_self) as self_count
    from (
      select local_date, bool_or(kind = 'self') as is_self,
        local_date - (row_number() over (order by local_date))::int as grp_key
      from public.completions
      where user_id = p_user
      group by local_date
    ) g
    group by grp_key
  ) runs;

  v_capacity := case
    when v_max_glow_ever >= 100 then 4
    when v_max_glow_ever >= 50 then 3
    when v_max_glow_ever >= 21 then 2
    else 1
  end;

  select coalesce(min(local_date), p_through) into v_start from public.completions where user_id = p_user;
  if v_start > p_through then
    return;
  end if;

  v_cursor := v_start;
  while v_cursor <= p_through loop
    if to_char(v_cursor, 'YYYY-MM') is distinct from v_month_key then
      v_month_key := to_char(v_cursor, 'YYYY-MM');
      v_holds_this_month := 0;
    end if;

    select exists(
      select 1 from public.completions where user_id = p_user and local_date = v_cursor and kind = 'self'
    ) into v_is_self;

    v_q := v_is_self;
    if not v_is_self then
      select exists(
        select 1 from public.completions where user_id = p_user and local_date = v_cursor and kind = 'covered'
      ) into v_is_covered;
      if v_is_covered and v_holds_this_month < v_capacity then
        v_q := true;
        v_holds_this_month := v_holds_this_month + 1;
      end if;
    end if;

    d := v_cursor;
    qualifies := v_q;
    return next;

    v_cursor := v_cursor + 1;
  end loop;
end;
$$;
revoke all on function public.glow_qualifying_days(uuid, date) from anon, public, authenticated;

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
  select p.other_id, p.other_name, coalesce(s.streak, 0)
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
