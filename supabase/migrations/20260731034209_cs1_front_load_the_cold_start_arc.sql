-- CS1 — front-load the cold-start arc.
--
-- MN2 shipped the self-manual and found its own foundation thin: the 13-day
-- cold-start arc carried exactly ONE declaration-lane question (day 10,
-- STR-03), so a tester who answered every single day still reached day 14
-- with a one-entry manual. The manual is what the friends cohort is being
-- asked to react to, so the arc gains four more declarations.
--
-- Cat's ruling, 30 July, in session (Option B of two tabled): five entries
-- across all FOUR manual sections, misread included.
--
--   day  out        in        lane · section
--    1   ENR-01     —         evidence
--    2   MOOD-01 →  MOOD-09   declaration · overwhelm-restore
--    3   HAB-01     —         evidence
--    4   MOT-01  →  ENR-09    declaration · energy-recovery
--    5   CON-01     —         evidence
--    6   MOT-06     —         evidence
--    7   CON-09     —         evidence
--    8   STR-05     —         evidence
--    9   SELF-05 →  SELF-12   declaration · misread
--   10   STR-03     —         declaration · overwhelm-restore  (unmoved)
--   11   SELF-06 →  SELF-11   evidence
--   12   VAL-02  →  CON-10    declaration · connection
--   13   VAL-05     —         evidence
--
-- TWO CONSTRAINTS SHAPED THAT TABLE, both derived from this function rather
-- than assumed:
--
-- (1) SUBSTITUTION ONLY, NEVER REORDERING. The arc is indexed by
--     v_cold_start_count — answered-or-skipped question days, not calendar
--     days — so a user mid-arc at count k has seen old days 1..k and will
--     next be served NEW days k+1..13. Any retained question that moved to a
--     LATER day would reappear for everyone whose count sits between the two
--     positions; a plain reorder repeated a question for four of the five
--     live mid-arc users. Every retained question therefore keeps its exact
--     day and only the five substituted days change, which makes "no repeats"
--     provable rather than lucky. The five questions leaving the arc
--     (MOOD-01, MOT-01, SELF-05, SELF-06, VAL-02) are all still in the
--     general pool from day 14 on, so nobody loses them — they arrive later.
--
-- (2) THE L2 CAP FORCED DAY 11 DOWN TO L1. Every declaration-lane question
--     in the bank carrying a manual_section is L2 (there are no L1 ones), and
--     the standing cap is 3 L2s per rolling 7 days. Today's arc already runs
--     L2 on days 10 AND 11, and any new declaration in week two pushes day
--     11's prior-6-day window to 3. SELF-06 (L2, evidence, no section — it
--     earned the manual nothing) becomes SELF-11, an L1 chips question that
--     also feeds the chip-trait lane. The resulting L2 days are 2, 4, 9, 10
--     and 12, and the cap holds by construction on every day of the arc: the
--     fullest prior-6-day window inside days 1-13 holds 3, never more.
--
--     ONE HONEST EXCEPTION, AT DAY 14, RULED BY CAT IN SESSION. Day 14 is
--     not part of the table above — it falls through to the follow-up branch,
--     which has NEVER enforced the depth cap, and every follow-up template in
--     the bank is L2. For a perfect tester that day resolves to FU-07 (source
--     STR-03, still on day 10), so days 8-14 hold FOUR L2s where the old arc
--     held three. Getting that window back to three means dropping one of
--     days 9/10/12, which drops the manual to four entries and misses the
--     acceptance metric. Cat's call was to ship as ruled: FU-07 asks the
--     person to recall something they already wrote rather than to dig, which
--     makes it the lightest L2 available, and the alternative — enforcing the
--     cap here — would hand a perfect tester the generic VAL-09 binary on the
--     one day the manual first appears. Recorded, not fixed, and deliberately
--     so; the follow-up branch is outside CS1's named jobs.
--
-- STR-10 was excluded from consideration throughout: it is pool = 'weekday'
-- and the arc branch ignores pool, so it would serve a workday question on a
-- Sunday.
--
-- JOB 3, the ride-along MN1 found: the arc select, the day-14 follow-up
-- select and the VAL-09 fallback all lacked `not is_archived`, so the retire
-- mechanism had a hole that would bite the first time one of those questions
-- was struck. All three are filtered now, and — because a filter that turns
-- a hard-coded pick into NULL would otherwise hand the user a blank screen —
-- the arc branch falls through: retired arc question → the follow-up path →
-- VAL-09 → a deterministic L1/L2 pick from the unseen, unarchived,
-- pool-appropriate remainder.
--
-- Nothing outside the arc branch changes. The post-arc eligibility pool,
-- scoring, rest logic, follow-up interpolation and the reflections upsert are
-- byte-identical to 20260712090000, so a user past day 14 sees exactly the
-- questions they saw before.

create or replace function public.get_daily_question(p_local_date date)
 returns table(id uuid, dimension text, prompt text, format text, depth text, options jsonb)
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_dow int := extract(dow from p_local_date)::int;
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
    count(distinct last_asks.dimension) as distinct_dims,
    max(last_asks.dimension) as only_dim
  into v_rest_rec
  from last_asks
  having count(*) = 2;

  if v_rest_rec.skip_count = 2 and v_rest_rec.distinct_dims = 1 then
    perform public._rest_question_dimension(v_user, v_rest_rec.only_dim, p_local_date + 14);
  end if;

  select not exists (
    select 1 from public.completions c where c.user_id = v_user and c.local_date = p_local_date - 1
  ) into v_missed_yesterday;

  select count(*) >= 1 into v_mood_le2_either
  from public.reflections r
  where r.user_id = v_user and r.local_date in (p_local_date - 1, p_local_date - 2) and r.mood <= 2;

  select count(*) = 2 into v_mood_le2_both
  from public.reflections r
  where r.user_id = v_user and r.local_date in (p_local_date - 1, p_local_date - 2) and r.mood <= 2;

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

  select count(*) into v_cold_start_count
  from public.reflections r
  where r.user_id = v_user and r.question_id is not null
    and (r.question_answer is not null or r.question_skipped)
    and r.local_date < p_local_date;

  if v_cold_start_count < 14 then
    v_arc_day := v_cold_start_count + 1;
    v_arc_code := case v_arc_day
      when 1 then 'ENR-01' when 2 then 'MOOD-09' when 3 then 'HAB-01' when 4 then 'ENR-09'
      when 5 then 'CON-01' when 6 then 'MOT-06' when 7 then 'CON-09' when 8 then 'STR-05'
      when 9 then 'SELF-12' when 10 then 'STR-03' when 11 then 'SELF-11' when 12 then 'CON-10'
      when 13 then 'VAL-05'
      else null
    end;

    -- JOB 3 (CS1): the arc's hard-coded pick is filtered by is_archived like
    -- every other select in this function. Retiring a question used to leave
    -- the arc serving it anyway; now the day falls through to the same
    -- follow-up/VAL-09 path day 14 uses, so a strike never blanks a day.
    if v_arc_code is not null then
      select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
        into v_selected_id, v_selected_dimension, v_selected_prompt, v_selected_format, v_selected_depth, v_selected_options
      from public.questions q where q.code = v_arc_code and not q.is_archived;
    end if;

    if v_selected_id is null then
      select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
        into v_selected_id, v_selected_dimension, v_selected_prompt, v_selected_format, v_selected_depth, v_selected_options
      from public.questions q
      where q.is_followup_template
        and not q.is_archived
        and v_followups_week < 2
        and q.source_question_code is not null
        and exists (
          select 1
          from public.reflections r2
          join public.questions qsrc on qsrc.code = q.source_question_code
          where r2.user_id = v_user
            and r2.question_id = qsrc.id
            and qsrc.format in ('short_text', 'chips')
            and r2.question_answer is not null
            and not r2.question_skipped
            and length(r2.question_answer) <= 120
            and r2.local_date >= p_local_date - 14 and r2.local_date < p_local_date
        )
      order by q.code
      limit 1;

      if v_selected_id is null then
        select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
          into v_selected_id, v_selected_dimension, v_selected_prompt, v_selected_format, v_selected_depth, v_selected_options
        from public.questions q where q.code = 'VAL-09' and not q.is_archived;
      end if;

      -- Last resort, reachable only if VAL-09 itself is ever retired: the
      -- arc must still hand back A question rather than an empty screen.
      -- Same L1-L2 rule the arc lives by, same md5 tie-break the post-arc
      -- pool uses, so it stays deterministic per user per date.
      if v_selected_id is null then
        select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
          into v_selected_id, v_selected_dimension, v_selected_prompt, v_selected_format, v_selected_depth, v_selected_options
        from public.questions q
        where q.code is not null
          and not q.is_archived
          and not q.is_followup_template
          and q.depth in ('L1', 'L2')
          and (q.pool = 'any' or (q.pool = 'weekend') = v_is_weekend)
          and not exists (
            select 1 from public.reflections r
            where r.user_id = v_user and r.question_id = q.id
          )
        order by md5(v_user::text || p_local_date::text || q.id::text) asc
        limit 1;
      end if;
    end if;
  else
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
        and not exists (
          select 1 from public.reflections r
          where r.user_id = v_user and r.question_id = q.id and r.local_date >= p_local_date - v_repeat_window
        )
        and not (q.depth = 'L2' and v_l2_count_week >= 3)
        and not (
          q.depth = 'L3' and (
            v_l3_count_week >= 1
            or v_missed_yesterday
            or v_last_l3_date = p_local_date - 1
            or v_mood_le2_either
          )
        )
        and not (v_missed_yesterday and q.dimension = 'SELF')
        and not exists (
          select 1 from public.question_dimension_rests qdr
          where qdr.user_id = v_user and qdr.dimension = q.dimension and qdr.rested_until >= p_local_date
        )
        and (
          not q.is_followup_template
          or (
            v_followups_week < 2
            and q.source_question_code is not null
            and exists (
              select 1
              from public.reflections r2
              join public.questions qsrc on qsrc.code = q.source_question_code
              where r2.user_id = v_user
                and r2.question_id = qsrc.id
                and qsrc.format in ('short_text', 'chips')
                and r2.question_answer is not null
                and not r2.question_skipped
                and length(r2.question_answer) <= 120
                and r2.local_date >= p_local_date - 14 and r2.local_date < p_local_date
            )
          )
        );

      exit when (select count(*) from tmp_eligible) > 0 or v_repeat_window <= 14;
      truncate tmp_eligible;
      v_repeat_window := case v_repeat_window when 30 then 21 else 14 end;
    end loop;

    if (select count(*) from tmp_eligible) = 0 then
      raise notice 'get_daily_question: no eligible question for user % on %', v_user, p_local_date;
      return;
    end if;

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

  v_final_prompt := v_selected_prompt;
  if v_selected_prompt like '%{answer}%' or v_selected_prompt like '%{weekday}%' then
    declare
      v_ref_answer text;
      v_ref_date date;
      v_source_code text;
    begin
      select q.source_question_code into v_source_code from public.questions q where q.id = v_selected_id;

      if v_source_code is not null then
        select r.question_answer, r.local_date into v_ref_answer, v_ref_date
        from public.reflections r
        join public.questions qsrc on qsrc.code = v_source_code
        where r.user_id = v_user
          and r.question_id = qsrc.id
          and qsrc.format in ('short_text', 'chips')
          and r.question_answer is not null
          and not r.question_skipped
          and length(r.question_answer) <= 120
          and r.local_date >= p_local_date - 14 and r.local_date < p_local_date
        order by r.local_date desc
        limit 1;

        if v_ref_answer is not null then
          v_final_prompt := replace(v_final_prompt, '{answer}', '*' || v_ref_answer || '*');
          if v_ref_date is not null then
            v_final_prompt := replace(v_final_prompt, '{weekday}', to_char(v_ref_date, 'FMDay'));
          end if;
        end if;
      end if;
    end;
  end if;

  insert into public.reflections (user_id, local_date, question_id, question_prompt_snapshot, question_skipped)
  values (v_user, p_local_date, v_selected_id, v_final_prompt, false)
  on conflict (user_id, local_date) do update
    set question_id = excluded.question_id,
        question_prompt_snapshot = excluded.question_prompt_snapshot
    where public.reflections.question_id is null;

  return query
  select v_selected_id, v_selected_dimension, v_final_prompt, v_selected_format, v_selected_depth, v_selected_options;
end;
$function$;

revoke all on function public.get_daily_question(date) from public;
revoke all on function public.get_daily_question(date) from anon;
grant execute on function public.get_daily_question(date) to authenticated;
grant execute on function public.get_daily_question(date) to service_role;

