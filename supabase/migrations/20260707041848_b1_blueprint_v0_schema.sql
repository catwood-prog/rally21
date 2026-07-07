-- B1: Blueprint v0 — deterministic pattern cards, no LLM (Rally21-Blueprint-Notes.md).
-- Patterns computed on read from the caller's own reflections/completions,
-- each with a hard minimum evidence bar; empty is honest.

create table public.blueprint_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  pattern_key text not null,
  response text not null check (response in ('confirmed', 'not_quite')),
  note text null,
  created_at timestamptz not null default now()
);

alter table public.blueprint_responses enable row level security;

create policy "a user can read their own blueprint responses"
  on public.blueprint_responses for select
  to authenticated
  using (user_id = auth.uid());

create policy "a user can save their own blueprint responses"
  on public.blueprint_responses for insert
  to authenticated
  with check (user_id = auth.uid());

-- Scarcity (Blueprint-Notes: each card an event, never a feed) — which
-- not-yet-responded pattern is currently "showing" for this user, and
-- when, so the next one only appears after a response or 7 days.
alter table public.users
  add column blueprint_surfaced_pattern_key text null,
  add column blueprint_surfaced_at timestamptz null;

create or replace function public.mark_blueprint_pattern_surfaced(p_pattern_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.users
  set blueprint_surfaced_pattern_key = p_pattern_key,
      blueprint_surfaced_at = now()
  where id = auth.uid();
end;
$$;
revoke all on function public.mark_blueprint_pattern_surfaced(text) from anon, public;
grant execute on function public.mark_blueprint_pattern_surfaced(text) to authenticated;

create or replace function public.get_my_blueprint()
returns table(
  pattern_key text,
  pattern_type text,
  weekday int,
  direction text,
  cutoff_hour int,
  agreement_count int,
  total_count int,
  evidence_rate numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tz text;
  v_overall_mean numeric;
  v_median numeric;
  w int;
  v_count int;
  v_mean numeric;
  v_gap numeric;
  v_agreement int;
  v_direction text;
  v_time_total int;
  v_time_before_noon_count int;
  v_time_agree int;
  v_time_rate numeric;
  v_cons_total int;
  v_mode_hour int;
  v_cons_agree int;
  v_cons_rate numeric;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(timezone, 'UTC') into v_tz from public.users where id = v_user;
  if v_tz is null then v_tz := 'UTC'; end if;

  create temporary table tmp_patterns (
    pattern_key text, pattern_type text, weekday int, direction text,
    cutoff_hour int, agreement_count int, total_count int, evidence_rate numeric
  ) on commit drop;

  -- overall mean + median mood across all of the caller's reflections
  select avg(mood)::numeric into v_overall_mean from public.reflections where user_id = v_user and mood is not null;

  if v_overall_mean is not null then
    select percentile_cont(0.5) within group (order by mood) into v_median
    from public.reflections where user_id = v_user and mood is not null;

    -- (a) weekday-mood: each weekday needs >=5 instances and a >=0.8 gap
    -- vs the user's own overall mean.
    for w in 0..6 loop
      select count(*), avg(mood)::numeric into v_count, v_mean
      from public.reflections
      where user_id = v_user and mood is not null
        and extract(dow from local_date) = w;

      if v_count >= 5 then
        v_gap := v_mean - v_overall_mean;
        if abs(v_gap) >= 0.8 then
          v_direction := case when v_gap < 0 then 'low' else 'high' end;
          if v_direction = 'low' then
            select count(*) into v_agreement from public.reflections
            where user_id = v_user and mood is not null and extract(dow from local_date) = w and mood < v_median;
          else
            select count(*) into v_agreement from public.reflections
            where user_id = v_user and mood is not null and extract(dow from local_date) = w and mood > v_median;
          end if;

          insert into tmp_patterns values (
            'weekday_' || w || '_' || v_direction, 'weekday_mood', w, v_direction, null,
            v_agreement, v_count, round(v_agreement::numeric / v_count, 3)
          );
        end if;
      end if;
    end loop;

    -- (b) time-of-day mood — same median-split/agreement-rate approach as
    -- the day-14 observation (lib/reflections.ts computeDayObservation),
    -- re-implemented server-side: >=10 data points, >=60% agreement.
    select count(*), count(*) filter (where extract(hour from created_at) < 12)
      into v_time_total, v_time_before_noon_count
      from public.reflections where user_id = v_user and mood is not null;

    if v_time_total >= 10 and v_time_before_noon_count > 0 and v_time_before_noon_count < v_time_total then
      declare
        v_avg_before numeric; v_avg_after numeric; v_before_higher boolean;
      begin
        select avg(mood)::numeric into v_avg_before from public.reflections
          where user_id = v_user and mood is not null and extract(hour from created_at) < 12;
        select avg(mood)::numeric into v_avg_after from public.reflections
          where user_id = v_user and mood is not null and extract(hour from created_at) >= 12;
        v_before_higher := v_avg_before >= v_avg_after;

        select count(*) into v_time_agree from public.reflections
          where user_id = v_user and mood is not null
            and (extract(hour from created_at) < 12) = v_before_higher
            and mood >= v_median
        union all
        select count(*) from public.reflections
          where user_id = v_user and mood is not null
            and (extract(hour from created_at) < 12) <> v_before_higher
            and mood < v_median;

        select sum(c) into v_time_agree from (
          select count(*) as c from public.reflections
            where user_id = v_user and mood is not null
              and ((extract(hour from created_at) < 12) = v_before_higher) = (mood >= v_median)
        ) x;

        v_time_rate := round(v_time_agree::numeric / v_time_total, 3);
        if v_time_rate >= 0.6 then
          v_direction := case when v_before_higher then 'before_noon_higher' else 'after_noon_higher' end;
          insert into tmp_patterns values (
            'time_of_day_' || v_direction, 'time_of_day_mood', null, v_direction, null,
            v_time_agree, v_time_total, v_time_rate
          );
        end if;
      end;
    end if;
  end if;

  -- (c) consistency: modal check-in hour over the last 21 days, >=10
  -- check-ins required, >=60% land at-or-before the modal hour.
  with recent_checkins as (
    select local_date, min(created_at) as first_created_at
    from public.completions
    where user_id = v_user and kind = 'self' and local_date >= (current_date - 21)
    group by local_date
  ),
  hours as (
    select extract(hour from (first_created_at at time zone v_tz))::int as h
    from recent_checkins
  )
  select count(*) into v_cons_total from hours;

  if v_cons_total >= 10 then
    select h into v_mode_hour from (
      select h, count(*) as c from (
        with recent_checkins as (
          select local_date, min(created_at) as first_created_at
          from public.completions
          where user_id = v_user and kind = 'self' and local_date >= (current_date - 21)
          group by local_date
        )
        select extract(hour from (first_created_at at time zone v_tz))::int as h from recent_checkins
      ) hh
      group by h
      order by c desc, h asc
      limit 1
    ) m;

    with recent_checkins as (
      select local_date, min(created_at) as first_created_at
      from public.completions
      where user_id = v_user and kind = 'self' and local_date >= (current_date - 21)
      group by local_date
    )
    select count(*) into v_cons_agree
    from recent_checkins
    where extract(hour from (first_created_at at time zone v_tz))::int <= v_mode_hour;

    v_cons_rate := round(v_cons_agree::numeric / v_cons_total, 3);
    if v_cons_rate >= 0.6 then
      insert into tmp_patterns values (
        'consistency', 'consistency', null, null, v_mode_hour + 1,
        v_cons_agree, v_cons_total, v_cons_rate
      );
    end if;
  end if;

  return query
  select t.pattern_key, t.pattern_type, t.weekday, t.direction, t.cutoff_hour,
         t.agreement_count, t.total_count, t.evidence_rate
  from tmp_patterns t
  where not exists (
    select 1 from public.blueprint_responses r
    where r.user_id = v_user and r.pattern_key = t.pattern_key and r.response = 'not_quite'
  )
  order by t.evidence_rate desc
  limit 3;
end;
$$;
revoke all on function public.get_my_blueprint() from anon, public;
grant execute on function public.get_my_blueprint() to authenticated;
