-- Q1: get_daily_question() rewrite — the adaptive question engine
-- (Rally21-Question-Engine-Spec.md §2-5). Replaces the old random-pick
-- implementation with deterministic, idempotent selection: cold-start
-- arc for a user's first 14 answered-or-skipped question days, then hard
-- filters + weighted scoring + md5 tiebreak.
--
-- Behavioral change from before: this function now WRITES (was `stable`,
-- now defaults to volatile) — the first call for a given local day
-- persists a bare reflections row (question_id + question_prompt_snapshot
-- only; mood/lines/answer stay null until the existing check-in
-- submission flow fills them in later via its own unchanged upsert).
-- This is what makes re-opening the check-in show the identical
-- question (invariant 5) and makes bank edits never retroactively change
-- an already-served day (invariant 6, via the frozen snapshot) — neither
-- was actually true of the old random-pick implementation.

create or replace function public.get_daily_question(p_local_date date)
returns table (id uuid, dimension text, prompt text, format text, depth text, options jsonb)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_dow int := extract(dow from p_local_date)::int; -- 0=Sunday..6=Saturday
  v_is_weekend boolean := v_dow in (0, 6);
  v_existing_question_id uuid;
  v_existing_snapshot text;
  v_rest_rec record;
  v_missed_yesterday boolean;
  v_mood_le2_either boolean;
  v_mood_le2_both boolean;
  v_milestone_today boolean;
  v_new_circle_recent boolean;
  v_cold_start_count int;
  v_arc_day int;
  v_arc_code text;
  v_selected_id uuid;
  v_selected_prompt text;
  v_selected_dimension text;
  v_selected_format text;
  v_selected_depth text;
  v_selected_options jsonb;
  v_final_prompt text;
  v_l2_count_week int;
  v_l3_count_week int;
  v_last_l3_date date;
  v_followups_week int;
  v_repeat_window int;
  v_top_score numeric;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- ---- 0) Idempotency: already selected today? Return it, write nothing. ----
  select r.question_id, r.question_prompt_snapshot
    into v_existing_question_id, v_existing_snapshot
  from public.reflections r
  where r.user_id = v_user and r.local_date = p_local_date;

  if v_existing_question_id is not null then
    return query
    select q.id, q.dimension, coalesce(v_existing_snapshot, q.prompt), q.format, q.depth, q.options
    from public.questions q
    where q.id = v_existing_question_id;
    return;
  end if;

  -- ---- 1) Dimension rest trigger (invariant 5.6): two consecutive
  -- same-dimension skips (the last 2 days a question was actually asked,
  -- strictly before today) → rest that dimension 14 days. Lazily
  -- evaluated here since nothing else ever writes this table. ----
  with last_asks as (
    select q.dimension, r.question_skipped
    from public.reflections r
    join public.questions q on q.id = r.question_id
    where r.user_id = v_user and r.question_id is not null and r.local_date < p_local_date
    order by r.local_date desc
    limit 2
  )
  select
    count(*) filter (where question_skipped) as skip_count,
    count(distinct dimension) as distinct_dims,
    max(dimension) as only_dim
  into v_rest_rec
  from last_asks
  having count(*) = 2; -- only meaningful once there are at least 2 prior asks

  if v_rest_rec.skip_count = 2 and v_rest_rec.distinct_dims = 1 then
    insert into public.question_dimension_rests (user_id, dimension, rested_until, updated_at)
    values (v_user, v_rest_rec.only_dim, p_local_date + 14, now())
    on conflict (user_id, dimension) do update
      set rested_until = greatest(question_dimension_rests.rested_until, excluded.rested_until),
          updated_at = now();
  end if;

  -- ---- Context signals (shared by hard filters + context_boost) ----
  select not exists (
    select 1 from public.completions c where c.user_id = v_user and c.local_date = p_local_date - 1
  ) into v_missed_yesterday;

  select count(*) >= 1 into v_mood_le2_either
  from public.reflections r
  where r.user_id = v_user and r.local_date in (p_local_date - 1, p_local_date - 2) and r.mood <= 2;

  select count(*) = 2 into v_mood_le2_both
  from public.reflections r
  where r.user_id = v_user and r.local_date in (p_local_date - 1, p_local_date - 2) and r.mood <= 2;

  -- Journey milestone today (day 7/14/21, or a rally-marker multiple of
  -- 21 past day 21) for any of the user's circles — mirrors compose-
  -- digest's own day-number math, deliberately simple (a day off either
  -- way is harmless for a context boost, not a hard gate).
  select exists (
    select 1
    from public.memberships m
    join public.circles c on c.id = m.circle_id
    where m.user_id = v_user
      and (p_local_date - c.start_date + 1) in (7, 14, 21)
  ) or exists (
    select 1
    from public.memberships m
    join public.circles c on c.id = m.circle_id
    where m.user_id = v_user
      and c.rallied_on_at is not null
      and (p_local_date - c.start_date + 1) > 21
      and ((p_local_date - c.start_date + 1) - 21) % 21 = 0
  ) into v_milestone_today;

  select exists (
    select 1 from public.memberships m
    where m.user_id = v_user and m.joined_at >= (p_local_date - 3)
  ) into v_new_circle_recent;

  -- Per-user weekly/recent derived stats (spec §1: computed, not stored).
  select count(*) into v_l2_count_week
  from public.reflections r join public.questions q on q.id = r.question_id
  where r.user_id = v_user and q.depth = 'L2' and r.local_date >= p_local_date - 6 and r.local_date < p_local_date;

  select count(*) into v_l3_count_week
  from public.reflections r join public.questions q on q.id = r.question_id
  where r.user_id = v_user and q.depth = 'L3' and r.local_date >= p_local_date - 6 and r.local_date < p_local_date;

  select max(r.local_date) into v_last_l3_date
  from public.reflections r join public.questions q on q.id = r.question_id
  where r.user_id = v_user and q.depth = 'L3' and r.local_date < p_local_date;

  select count(*) into v_followups_week
  from public.reflections r join public.questions q on q.id = r.question_id
  where r.user_id = v_user and q.is_followup_template and r.local_date >= p_local_date - 6 and r.local_date < p_local_date;

  -- ---- 2) Cold start: first 14 answered-or-skipped question days follow
  -- the bank's fixed arc. Existing users are NOT cold-start by
  -- construction — this counts ALL historical qualifying days, so
  -- anyone with >=14 already is automatically past it, no flag needed. ----
  select count(*) into v_cold_start_count
  from public.reflections r
  where r.user_id = v_user and r.question_id is not null
    and (r.question_answer is not null or r.question_skipped)
    and r.local_date < p_local_date;

  if v_cold_start_count < 14 then
    v_arc_day := v_cold_start_count + 1;
    v_arc_code := case v_arc_day
      when 1 then 'ENR-01' when 2 then 'MOOD-01' when 3 then 'HAB-01' when 4 then 'MOT-01'
      when 5 then 'CON-01' when 6 then 'MOT-06' when 7 then 'CON-09' when 8 then 'STR-05'
      when 9 then 'SELF-05' when 10 then 'STR-03' when 11 then 'SELF-06' when 12 then 'VAL-02'
      when 13 then 'VAL-05'
      else null -- day 14: first eligible follow-up, else VAL-09 (resolved below)
    end;

    if v_arc_code is not null then
      select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
        into v_selected_id, v_selected_dimension, v_selected_prompt, v_selected_format, v_selected_depth, v_selected_options
      from public.questions q where q.code = v_arc_code;
    else
      -- Day 14: first eligible follow-up (same eligibility rule as
      -- ordinary selection — a referenced short_text answer in the last
      -- 14 days, and under the weekly cap), in bank order; else VAL-09.
      select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
        into v_selected_id, v_selected_dimension, v_selected_prompt, v_selected_format, v_selected_depth, v_selected_options
      from public.questions q
      where q.is_followup_template
        and v_followups_week < 2
        and exists (
          select 1 from public.reflections r2
          join public.questions q2 on q2.id = r2.question_id
          where r2.user_id = v_user and q2.dimension = q.dimension and q2.format = 'short_text'
            and not q2.is_followup_template and r2.question_answer is not null
            and r2.local_date >= p_local_date - 14 and r2.local_date < p_local_date
        )
      order by q.code
      limit 1;

      if v_selected_id is null then
        select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
          into v_selected_id, v_selected_dimension, v_selected_prompt, v_selected_format, v_selected_depth, v_selected_options
        from public.questions q where q.code = 'VAL-09';
      end if;
    end if;
  else
    -- ---- 3) Scoring path (spec §2). Hard filters first (never relax
    -- depth/comfort filters), relaxation ladder only on the 30-day
    -- repeat window, then weighted score + md5 tiebreak. ----
    drop table if exists tmp_eligible;
    create temporary table tmp_eligible (
      id uuid, dimension text, prompt text, format text, depth text, options jsonb,
      is_followup boolean
    ) on commit drop;

    v_repeat_window := 30;
    loop
      insert into tmp_eligible (id, dimension, prompt, format, options, depth, is_followup)
      select q.id, q.dimension, q.prompt, q.format, q.options, q.depth, q.is_followup_template
      from public.questions q
      where q.code is not null and not q.is_archived
        and (q.pool = 'any' or (q.pool = 'weekend') = v_is_weekend)
        -- filter 2: not asked in the repeat window (any status)
        and not exists (
          select 1 from public.reflections r
          where r.user_id = v_user and r.question_id = q.id and r.local_date >= p_local_date - v_repeat_window
        )
        -- filter 3: depth caps (hard, never relaxed)
        and not (q.depth = 'L2' and v_l2_count_week >= 3)
        and not (
          q.depth = 'L3' and (
            v_l3_count_week >= 1
            or v_missed_yesterday
            or v_last_l3_date = p_local_date - 1
            or v_mood_le2_either
          )
        )
        -- filter 4: missed day yesterday excludes all SELF questions
        and not (v_missed_yesterday and q.dimension = 'SELF')
        -- filter 5: dimension currently rested
        and not exists (
          select 1 from public.question_dimension_rests qdr
          where qdr.user_id = v_user and qdr.dimension = q.dimension and qdr.rested_until >= p_local_date
        )
        -- filter 7: follow-up eligibility
        and (
          not q.is_followup_template
          or (
            v_followups_week < 2
            and exists (
              select 1 from public.reflections r2
              join public.questions q2 on q2.id = r2.question_id
              where r2.user_id = v_user and q2.dimension = q.dimension and q2.format = 'short_text'
                and not q2.is_followup_template and r2.question_answer is not null
                and r2.local_date >= p_local_date - 14 and r2.local_date < p_local_date
            )
          )
        );

      exit when (select count(*) from tmp_eligible) > 0 or v_repeat_window <= 14;
      truncate tmp_eligible;
      v_repeat_window := case v_repeat_window when 30 then 21 else 14 end;
    end loop;

    if (select count(*) from tmp_eligible) = 0 then
      -- Question-less day (spec: "fine, log it"). Nothing to persist.
      raise notice 'get_daily_question: no eligible question for user % on %', v_user, p_local_date;
      return;
    end if;

    -- ---- Step 2: score the eligible set ----
    drop table if exists tmp_scored;
    create temporary table tmp_scored (
      id uuid, dimension text, prompt text, format text, depth text, options jsonb,
      is_followup boolean, score numeric
    ) on commit drop;

    insert into tmp_scored
    select
      e.id, e.dimension, e.prompt, e.format, e.depth, e.options, e.is_followup,
      0.35 * (1 - least(1, (
        coalesce((
          select sum(case when r.local_date >= p_local_date - 90 then 1 else 0.5 end)
          from public.reflections r join public.questions q3 on q3.id = r.question_id
          where r.user_id = v_user and q3.dimension = e.dimension and r.question_answer is not null
        ), 0)
      ) / 8.0))
      + 0.20 * least(1, coalesce((
          select (p_local_date - max(r.local_date))
          from public.reflections r join public.questions q4 on q4.id = r.question_id
          where r.user_id = v_user and q4.dimension = e.dimension
        ), 999) / 21.0)
      + 0.30 * (
          case
            when v_missed_yesterday and e.dimension in ('MOT', 'HAB') then 0.9
            when v_mood_le2_both and e.dimension in ('CON', 'STR') and e.depth in ('L1', 'L2') then 0.9
            when v_milestone_today and e.dimension = 'VAL' then 0.8
            when v_new_circle_recent and e.dimension = 'CON' then 0.6
            else 0
          end
        )
      - (case e.depth when 'L1' then 0 when 'L2' then 0.10 when 'L3' then 0.25 else 0 end)
      - (
          coalesce((
            select 0.15 from public.reflections r5 join public.questions q5 on q5.id = r5.question_id
            where r5.user_id = v_user and r5.local_date = p_local_date - 1 and q5.dimension = e.dimension
            limit 1
          ), 0)
          + coalesce((
            select 0.10 from public.reflections r6
            where r6.user_id = v_user and r6.question_id = e.id
              and r6.local_date >= p_local_date - 60 and r6.local_date < p_local_date - 30
            limit 1
          ), 0)
        )
    from tmp_eligible e;

    select max(score) into v_top_score from tmp_scored;

    -- ---- Step 3: deterministic tiebreak among candidates within 0.05 of
    -- the top score — lowest md5(user_id || local_date || question_id). ----
    select s.id, s.dimension, s.prompt, s.format, s.depth, s.options
      into v_selected_id, v_selected_dimension, v_selected_prompt, v_selected_format, v_selected_depth, v_selected_options
    from tmp_scored s
    where s.score >= v_top_score - 0.05
    order by md5(v_user::text || p_local_date::text || s.id::text) asc
    limit 1;
  end if;

  if v_selected_id is null then
    return;
  end if;

  -- ---- Follow-up interpolation: {answer}/{weekday} filled with the
  -- most recent referenced short_text answer, wrapped in *asterisks* like
  -- every other question's personal word. Frozen into the snapshot below
  -- so a later reopen renders identically even if a newer answer arrives
  -- in the meantime. ----
  v_final_prompt := v_selected_prompt;
  if v_selected_prompt like '%{answer}%' or v_selected_prompt like '%{weekday}%' then
    declare
      v_ref_answer text;
      v_ref_date date;
    begin
      select r.question_answer, r.local_date into v_ref_answer, v_ref_date
      from public.reflections r
      join public.questions q on q.id = r.question_id
      where r.user_id = v_user and q.dimension = v_selected_dimension and q.format = 'short_text'
        and not q.is_followup_template and r.question_answer is not null
        and r.local_date >= p_local_date - 14 and r.local_date < p_local_date
      order by r.local_date desc
      limit 1;

      if v_ref_answer is not null then
        v_final_prompt := replace(v_final_prompt, '{answer}', '*' || v_ref_answer || '*');
        if v_ref_date is not null then
          v_final_prompt := replace(v_final_prompt, '{weekday}', to_char(v_ref_date, 'FMDay'));
        end if;
      end if;
    end;
  end if;

  -- ---- Persist the selection (only if this local day hasn't already
  -- been answered elsewhere in the meantime) — this is what makes the
  -- question stable across a close-and-reopen, and immune to later bank
  -- edits (invariants 5 and 6). ----
  insert into public.reflections (user_id, local_date, question_id, question_prompt_snapshot, question_skipped)
  values (v_user, p_local_date, v_selected_id, v_final_prompt, false)
  on conflict (user_id, local_date) do update
    set question_id = excluded.question_id,
        question_prompt_snapshot = excluded.question_prompt_snapshot
    where public.reflections.question_id is null;

  return query
  select v_selected_id, v_selected_dimension, v_final_prompt, v_selected_format, v_selected_depth, v_selected_options;
end;
$$;

revoke all on function public.get_daily_question(date) from anon, public;
grant execute on function public.get_daily_question(date) to authenticated;
