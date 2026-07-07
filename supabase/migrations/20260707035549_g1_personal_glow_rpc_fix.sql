-- Fixes two bugs found during live verification of the first draft:
-- 1. last-break tracking was re-triggered on every subsequent inactive
--    day of a sustained-inactivity stretch, so a user cold for a week
--    would spuriously read as freshly-embers forever (the deadline
--    always recomputed from "yesterday"). Now only the FIRST inactive
--    day of a broken stretch sets last_break_date/glow_before_break.
-- 2. the ember deadline was off by one day (used +2 instead of +3):
--    end of the missed day = start of (missed_day+1); +48h from there
--    = start of (missed_day+3), not (missed_day+2).

create or replace function public.get_my_glow()
returns table(
  glow int,
  state text,
  ember_deadline timestamptz,
  held_today boolean,
  shelter_used int,
  shelter_capacity int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tz text;
  v_today date;
  v_yesterday date;
  v_start date;
  v_cursor date;
  v_max_glow_ever int;
  v_capacity int;
  v_running_count int := 0;
  v_month_key text := null;
  v_holds_this_month int := 0;
  v_in_broken_stretch boolean := false;
  v_last_break_date date := null;
  v_glow_before_last_break int := 0;
  v_is_self boolean;
  v_is_covered boolean;
  v_held boolean;
  v_today_self boolean;
  v_today_covered boolean;
  v_holds_used int := 0;
  v_glow int;
  v_state text;
  v_ember_deadline timestamptz := null;
  v_held_today boolean := false;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(timezone, 'UTC') into v_tz from public.users where id = v_user;
  if v_tz is null then v_tz := 'UTC'; end if;

  v_today := (now() at time zone v_tz)::date;
  v_yesterday := v_today - 1;

  select coalesce(max(self_count), 0) into v_max_glow_ever
  from (
    select grp_key, count(*) filter (where is_self) as self_count
    from (
      select local_date, bool_or(kind = 'self') as is_self,
        local_date - (row_number() over (order by local_date))::int as grp_key
      from public.completions
      where user_id = v_user
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

  select coalesce(min(local_date), v_today) into v_start from public.completions where user_id = v_user;

  v_cursor := v_start;
  while v_cursor <= v_yesterday loop
    if to_char(v_cursor, 'YYYY-MM') is distinct from v_month_key then
      v_month_key := to_char(v_cursor, 'YYYY-MM');
      v_holds_this_month := 0;
    end if;

    select exists(
      select 1 from public.completions
      where user_id = v_user and local_date = v_cursor and kind = 'self'
    ) into v_is_self;

    v_held := false;
    if not v_is_self then
      select exists(
        select 1 from public.completions
        where user_id = v_user and local_date = v_cursor and kind = 'covered'
      ) into v_is_covered;
      if v_is_covered and v_holds_this_month < v_capacity then
        v_held := true;
        v_holds_this_month := v_holds_this_month + 1;
      end if;
    end if;

    if v_is_self then
      v_running_count := v_running_count + 1;
      v_in_broken_stretch := false;
    elsif v_held then
      v_in_broken_stretch := false;
    else
      if not v_in_broken_stretch then
        v_glow_before_last_break := v_running_count;
        v_last_break_date := v_cursor;
        v_in_broken_stretch := true;
      end if;
      v_running_count := 0;
    end if;

    v_cursor := v_cursor + 1;
  end loop;

  if to_char(v_today, 'YYYY-MM') is distinct from v_month_key then
    v_holds_this_month := 0;
  end if;
  v_holds_used := v_holds_this_month;

  select exists(
    select 1 from public.completions where user_id = v_user and local_date = v_today and kind = 'self'
  ) into v_today_self;
  select exists(
    select 1 from public.completions where user_id = v_user and local_date = v_today and kind = 'covered'
  ) into v_today_covered;

  if v_running_count > 0 or v_last_break_date is null then
    -- chain alive through yesterday (or no break ever / no history at all)
    if v_today_self then
      v_glow := v_running_count + 1;
      v_state := 'glowing';
    elsif v_today_covered and v_holds_this_month < v_capacity then
      v_glow := v_running_count;
      v_state := 'glowing';
      v_held_today := true;
      v_holds_used := v_holds_this_month + 1;
    else
      v_glow := v_running_count;
      v_state := 'glowing';
    end if;
    v_ember_deadline := null;
  else
    -- currently broken since v_last_break_date (the ORIGINAL miss day of
    -- this stretch, fixed regardless of how many inactive days followed)
    v_ember_deadline := ((v_last_break_date + 3)::timestamp at time zone v_tz);
    if v_today_covered then
      v_held_today := true; -- display-only: someone covered today's slot,
                             -- even though it doesn't rekindle the glow
    end if;
    if v_today_self and now() < v_ember_deadline then
      v_glow := v_glow_before_last_break + 1;
      v_state := 'glowing';
      v_ember_deadline := null;
    elsif now() < v_ember_deadline then
      v_state := 'embers';
      v_glow := v_glow_before_last_break;
    else
      -- window fully expired — a check-in today (if any) starts fresh at 1
      v_state := 'cold';
      v_glow := case when v_today_self then 1 else 0 end;
      if v_today_self then v_state := 'glowing'; end if;
      v_ember_deadline := null;
    end if;
  end if;

  return query select v_glow, v_state, v_ember_deadline, v_held_today, v_holds_used, v_capacity;
end;
$$;
revoke all on function public.get_my_glow() from anon, public;
grant execute on function public.get_my_glow() to authenticated;
