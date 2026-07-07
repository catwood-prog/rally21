-- G5 (7 July): the glow moment's week row (Rally21-Glow-Spec.md §1,
-- Cat's Duolingo-style post-check-in beat). Mirrors get_glow_for_user's
-- own shelter-capacity derivation and month-boundary hold accounting
-- exactly, so the week row's "held" days never disagree with the
-- aggregate glow number — but only needs a walk from the start of the
-- 7-day window's calendar month (capacity resets every month, so
-- anything earlier can't affect this window's hold accounting), not
-- the full history get_glow_for_user itself needs to walk.
create or replace function public.get_week_for_user(p_user uuid)
returns table(day_date date, state text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
  v_window_start date;
  v_max_glow_ever int;
  v_capacity int;
  v_cursor date;
  v_month_key text := null;
  v_holds_this_month int := 0;
  v_is_self boolean;
  v_is_covered boolean;
  v_held boolean;
begin
  if p_user is null then
    raise exception 'p_user is required';
  end if;

  select coalesce(timezone, 'UTC') into v_tz from public.users where id = p_user;
  if v_tz is null then v_tz := 'UTC'; end if;

  v_today := (now() at time zone v_tz)::date;
  v_window_start := v_today - 6;

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

  v_cursor := date_trunc('month', v_window_start)::date;

  while v_cursor <= v_today loop
    if to_char(v_cursor, 'YYYY-MM') is distinct from v_month_key then
      v_month_key := to_char(v_cursor, 'YYYY-MM');
      v_holds_this_month := 0;
    end if;

    select exists(
      select 1 from public.completions
      where user_id = p_user and local_date = v_cursor and kind = 'self'
    ) into v_is_self;

    v_held := false;
    if not v_is_self then
      select exists(
        select 1 from public.completions
        where user_id = p_user and local_date = v_cursor and kind = 'covered'
      ) into v_is_covered;
      if v_is_covered and v_holds_this_month < v_capacity then
        v_held := true;
        v_holds_this_month := v_holds_this_month + 1;
      end if;
    end if;

    if v_cursor >= v_window_start then
      return query select v_cursor, case when v_is_self then 'earned' when v_held then 'held' else 'none' end;
    end if;

    v_cursor := v_cursor + 1;
  end loop;
end;
$$;

-- This project's default ACL grants EXECUTE on new functions to anon/
-- authenticated/PUBLIC automatically (confirmed via pg_default_acl) —
-- CLAUDE.md's S1 convention assumes the opposite, so every new function
-- needs an explicit revoke, not just an explicit grant. Without this,
-- get_week_for_user(p_user uuid) would be callable by anon with an
-- arbitrary uuid — a real cross-user glow-history leak.
revoke all on function public.get_week_for_user(uuid) from public;
revoke all on function public.get_week_for_user(uuid) from anon;
revoke all on function public.get_week_for_user(uuid) from authenticated;
grant execute on function public.get_week_for_user(uuid) to service_role;

create or replace function public.get_my_week()
returns table(day_date date, state text)
language sql
security definer
set search_path = public
as $$
  select * from public.get_week_for_user(auth.uid());
$$;

revoke all on function public.get_my_week() from public;
revoke all on function public.get_my_week() from anon;
grant execute on function public.get_my_week() to authenticated;
