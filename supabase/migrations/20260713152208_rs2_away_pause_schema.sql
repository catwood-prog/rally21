-- RS2: the away pause. Person-level self-serve toggle; while away,
-- everything freezes: no nudges/digest/ember/wave email, ember/glow
-- fully protected, sleeping-penguin presence in the circle screen.
alter table public.users
  add column away_since timestamptz null;

-- Durable, retroactive protection: at RETURN time (either the settings
-- toggle or simply checking in), return_from_away() backfills one
-- 'away'-kind completions row per missed day since away_since, exactly
-- mirroring how 'covered' already proves this pattern works. This is
-- what makes the protection PERMANENT even after away_since itself is
-- cleared on return — a live away_since check alone would silently stop
-- protecting those specific days the moment it's nulled, since every
-- glow computation re-walks the caller's entire history from scratch on
-- every call (no caching). Widening the kind enum (not just adding the
-- away_since column) was a deliberate scope decision beyond the
-- prompt's literal one-column schema ask — see the migration's own
-- comments below and the commit message for the full reasoning.
alter table public.completions
  drop constraint completions_kind_check,
  add constraint completions_kind_check
    check (kind = any (array['self', 'covered', 'away']));

alter table public.completions
  drop constraint completions_covered_by_matches_kind,
  add constraint completions_covered_by_matches_kind
    check (
      (kind = 'self' and covered_by is null)
      or (kind = 'covered')
      or (kind = 'away' and covered_by is null)
    );

-- get_glow_for_user: away days (backfilled 'away' rows for a resolved
-- spell, OR the live away_since flag for an still-ongoing one) are held
-- — never break the streak, never grow it, never consume shelter
-- capacity (unlike covered days, which are capacity-limited). The ember
-- deadline is extended by exactly how many away-held days already fall
-- within the current unresolved break (v_away_holds_in_break), so a
-- pause never silently eats into real rescue time; while still
-- currently away, the state is simply frozen (never cools to 'cold' no
-- matter how much real time has passed).
create or replace function public.get_glow_for_user(p_user uuid)
returns table(glow integer, state text, ember_deadline timestamptz, held_today boolean, shelter_used integer, shelter_capacity integer, missed_local_date date)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
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
  v_away_holds_in_break int := 0;
  v_away_since timestamptz;
  v_away_since_date date;
  v_is_self boolean;
  v_is_covered boolean;
  v_is_away_row boolean;
  v_held boolean;
  v_held_by_away boolean;
  v_today_self boolean;
  v_today_covered boolean;
  v_today_away boolean;
  v_holds_used int := 0;
  v_glow int;
  v_state text;
  v_ember_deadline timestamptz := null;
  v_held_today boolean := false;
begin
  if p_user is null then
    raise exception 'p_user is required';
  end if;

  select coalesce(timezone, 'UTC'), away_since into v_tz, v_away_since from public.users where id = p_user;
  if v_tz is null then v_tz := 'UTC'; end if;
  v_away_since_date := case when v_away_since is not null then (v_away_since at time zone v_tz)::date else null end;

  v_today := (now() at time zone v_tz)::date;
  v_yesterday := v_today - 1;

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

  select coalesce(min(local_date), v_today) into v_start from public.completions where user_id = p_user;

  v_cursor := v_start;
  while v_cursor <= v_yesterday loop
    if to_char(v_cursor, 'YYYY-MM') is distinct from v_month_key then
      v_month_key := to_char(v_cursor, 'YYYY-MM');
      v_holds_this_month := 0;
    end if;

    select exists(
      select 1 from public.completions
      where user_id = p_user and local_date = v_cursor and kind = 'self'
    ) into v_is_self;

    v_held := false;
    v_held_by_away := false;
    if not v_is_self then
      select exists(
        select 1 from public.completions
        where user_id = p_user and local_date = v_cursor and kind = 'away'
      ) into v_is_away_row;
      if v_is_away_row or (v_away_since_date is not null and v_cursor >= v_away_since_date) then
        v_held := true;
        v_held_by_away := true;
      else
        select exists(
          select 1 from public.completions
          where user_id = p_user and local_date = v_cursor and kind = 'covered'
        ) into v_is_covered;
        if v_is_covered and v_holds_this_month < v_capacity then
          v_held := true;
          v_holds_this_month := v_holds_this_month + 1;
        end if;
      end if;
    end if;

    if v_is_self then
      v_running_count := v_running_count + 1;
      v_in_broken_stretch := false;
      v_away_holds_in_break := 0;
    else
      if v_held then
        v_in_broken_stretch := false;
        if v_held_by_away and v_last_break_date is not null and v_running_count = 0 then
          v_away_holds_in_break := v_away_holds_in_break + 1;
        end if;
      else
        if not v_in_broken_stretch then
          v_glow_before_last_break := v_running_count;
          v_last_break_date := v_cursor;
          v_in_broken_stretch := true;
          v_away_holds_in_break := 0;
        end if;
        v_running_count := 0;
      end if;
    end if;

    v_cursor := v_cursor + 1;
  end loop;

  if to_char(v_today, 'YYYY-MM') is distinct from v_month_key then
    v_holds_this_month := 0;
  end if;
  v_holds_used := v_holds_this_month;

  select exists(
    select 1 from public.completions where user_id = p_user and local_date = v_today and kind = 'self'
  ) into v_today_self;
  select exists(
    select 1 from public.completions where user_id = p_user and local_date = v_today and kind = 'covered'
  ) into v_today_covered;
  v_today_away := v_away_since_date is not null and v_today >= v_away_since_date;

  if v_running_count > 0 or v_last_break_date is null then
    if v_today_self then
      v_glow := v_running_count + 1;
      v_state := 'glowing';
    elsif v_today_away then
      v_glow := v_running_count;
      v_state := 'glowing';
      v_held_today := true;
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
    v_ember_deadline := ((v_last_break_date + 3 + v_away_holds_in_break)::timestamp at time zone v_tz);
    if v_today_covered then
      v_held_today := true;
    end if;
    if v_today_away then
      v_held_today := true;
      v_state := 'embers';
      v_glow := v_glow_before_last_break;
      v_ember_deadline := null;
    elsif v_today_self and now() < v_ember_deadline then
      v_glow := v_glow_before_last_break + 1;
      v_state := 'glowing';
      v_ember_deadline := null;
    elsif now() < v_ember_deadline then
      v_state := 'embers';
      v_glow := v_glow_before_last_break;
    else
      v_state := 'cold';
      v_glow := case when v_today_self then 1 else 0 end;
      if v_today_self then v_state := 'glowing'; end if;
      v_ember_deadline := null;
    end if;
  end if;

  return query select v_glow, v_state, v_ember_deadline, v_held_today, v_holds_used, v_capacity, v_last_break_date;
end;
$function$;

-- get_week_for_user must agree with get_glow_for_user exactly (G5's own
-- discipline): away days (backfilled row OR live flag) render as
-- 'held', same visual as a covered day, never consuming capacity.
create or replace function public.get_week_for_user(p_user uuid)
returns table(day_date date, state text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tz text;
  v_today date;
  v_window_start date;
  v_max_glow_ever int;
  v_capacity int;
  v_cursor date;
  v_month_key text := null;
  v_holds_this_month int := 0;
  v_away_since timestamptz;
  v_away_since_date date;
  v_is_self boolean;
  v_is_covered boolean;
  v_is_away_row boolean;
  v_held boolean;
begin
  if p_user is null then
    raise exception 'p_user is required';
  end if;

  select coalesce(timezone, 'UTC'), away_since into v_tz, v_away_since from public.users where id = p_user;
  if v_tz is null then v_tz := 'UTC'; end if;
  v_away_since_date := case when v_away_since is not null then (v_away_since at time zone v_tz)::date else null end;

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
        where user_id = p_user and local_date = v_cursor and kind = 'away'
      ) into v_is_away_row;
      if v_is_away_row or (v_away_since_date is not null and v_cursor >= v_away_since_date) then
        v_held := true;
      else
        select exists(
          select 1 from public.completions
          where user_id = p_user and local_date = v_cursor and kind = 'covered'
        ) into v_is_covered;
        if v_is_covered and v_holds_this_month < v_capacity then
          v_held := true;
          v_holds_this_month := v_holds_this_month + 1;
        end if;
      end if;
    end if;

    if v_cursor >= v_window_start then
      return query select v_cursor, case when v_is_self then 'earned' when v_held then 'held' else 'none' end;
    end if;

    v_cursor := v_cursor + 1;
  end loop;
end;
$function$;

-- glow_qualifying_days backs get_pair_streaks — deliberately extended
-- the same way (not explicitly named in the RS2 prompt, but leaving it
-- out would let a friend streak silently break during an away spell
-- even though the personal glow explicitly says "protected", a glaring
-- inconsistency the feature's own "pause everything" framing implies
-- should not happen).
create or replace function public.glow_qualifying_days(p_user uuid, p_through date)
returns table(d date, qualifies boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_max_glow_ever int;
  v_capacity int;
  v_start date;
  v_cursor date;
  v_month_key text := null;
  v_holds_this_month int := 0;
  v_tz text;
  v_away_since timestamptz;
  v_away_since_date date;
  v_is_self boolean;
  v_is_covered boolean;
  v_is_away_row boolean;
  v_q boolean;
begin
  select coalesce(timezone, 'UTC'), away_since into v_tz, v_away_since from public.users where id = p_user;
  v_away_since_date := case when v_away_since is not null then (v_away_since at time zone v_tz)::date else null end;

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
        select 1 from public.completions where user_id = p_user and local_date = v_cursor and kind = 'away'
      ) into v_is_away_row;
      if v_is_away_row or (v_away_since_date is not null and v_cursor >= v_away_since_date) then
        v_q := true;
      else
        select exists(
          select 1 from public.completions where user_id = p_user and local_date = v_cursor and kind = 'covered'
        ) into v_is_covered;
        if v_is_covered and v_holds_this_month < v_capacity then
          v_q := true;
          v_holds_this_month := v_holds_this_month + 1;
        end if;
      end if;
    end if;

    d := v_cursor;
    qualifies := v_q;
    return next;

    v_cursor := v_cursor + 1;
  end loop;
end;
$function$;

-- return_from_away(): the "return" side of the pause. Backfills one
-- 'away' completions row per missed day since away_since (across every
-- currently-active circle the caller belongs to — personal glow doesn't
-- care which circle, but circle-level presence/signal shouldn't look
-- broken in ANY of them either, mirroring how a cover already counts
-- toward circle glow per CLAUDE.md's cover-a-friend rule), then clears
-- away_since. on conflict do nothing means a genuine real check-in
-- during the "away" window always wins over the synthetic backfill row.
-- Idempotent no-op if the caller isn't currently away.
create or replace function public.return_from_away()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_away_since timestamptz;
  v_tz text;
  v_away_date date;
  v_today date;
  v_cursor date;
  v_circle_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select away_since, coalesce(timezone, 'UTC') into v_away_since, v_tz from public.users where id = v_user;
  if v_away_since is null then
    return;
  end if;

  v_away_date := (v_away_since at time zone v_tz)::date;
  v_today := (now() at time zone v_tz)::date;

  v_cursor := v_away_date;
  while v_cursor < v_today loop
    for v_circle_id in
      select m.circle_id from public.memberships m
      join public.circles c on c.id = m.circle_id
      where m.user_id = v_user and c.is_active = true
    loop
      insert into public.completions (user_id, circle_id, local_date, kind)
      values (v_user, v_circle_id, v_cursor, 'away')
      on conflict (circle_id, user_id, local_date) do nothing;
    end loop;
    v_cursor := v_cursor + 1;
  end loop;

  update public.users set away_since = null where id = v_user;
end;
$function$;

revoke all on function public.return_from_away() from public;
revoke all on function public.return_from_away() from anon;
grant execute on function public.return_from_away() to authenticated;
