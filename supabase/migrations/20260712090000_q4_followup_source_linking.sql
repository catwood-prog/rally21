-- Q4: Follow-up questions must quote their own source question

-- 1. Schema: link each follow-up template to the one question it quotes.
alter table public.questions
  add column source_question_code text null;

alter table public.questions
  add constraint questions_source_question_code_fkey
  foreign key (source_question_code) references public.questions(code);

update public.questions set source_question_code = 'HAB-02' where code = 'FU-01';
update public.questions set source_question_code = 'STR-02' where code = 'FU-02';
update public.questions set source_question_code = 'MOOD-02' where code = 'FU-03';
update public.questions set source_question_code = 'CON-08' where code = 'FU-04';
update public.questions set source_question_code = 'VAL-04' where code = 'FU-05';
update public.questions set source_question_code = 'SELF-03' where code = 'FU-06';
update public.questions set source_question_code = 'STR-03' where code = 'FU-07';
update public.questions set source_question_code = 'MOT-13' where code = 'FU-08';
update public.questions set source_question_code = 'HAB-09' where code = 'FU-09';
update public.questions set source_question_code = 'VAL-02' where code = 'FU-10';

-- 5. Wording fix: CON-02 and ENR-03 were phrased as yes/no but render as bare 1-5
-- scale chips. Reword to read as a scale question. Served days are unaffected
-- (question_prompt_snapshot freezes the wording at serve time).
update public.questions
  set prompt = 'How sure are you that your circle would *notice* if you went quiet?'
  where code = 'CON-02';

update public.questions
  set prompt = 'How well did last night''s *sleep* set you up?'
  where code = 'ENR-03';

-- 2/3/4. get_daily_question(): all three same-dimension-short_text lookups
-- (cold-start day-14 fallback, scoring-phase follow-up eligibility, and the
-- {answer}/{weekday} substitution) now resolve the follow-up's own linked
-- source_question_code instead of any same-dimension short_text answer.
-- Source formats allowed: short_text or chips (never scale/binary). A source
-- answer over 120 characters makes the template ineligible that day.
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
      when 1 then 'ENR-01' when 2 then 'MOOD-01' when 3 then 'HAB-01' when 4 then 'MOT-01'
      when 5 then 'CON-01' when 6 then 'MOT-06' when 7 then 'CON-09' when 8 then 'STR-05'
      when 9 then 'SELF-05' when 10 then 'STR-03' when 11 then 'SELF-06' when 12 then 'VAL-02'
      when 13 then 'VAL-05'
      else null
    end;

    if v_arc_code is not null then
      select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
        into v_selected_id, v_selected_dimension, v_selected_prompt, v_selected_format, v_selected_depth, v_selected_options
      from public.questions q where q.code = v_arc_code;
    else
      select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
        into v_selected_id, v_selected_dimension, v_selected_prompt, v_selected_format, v_selected_depth, v_selected_options
      from public.questions q
      where q.is_followup_template
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
        from public.questions q where q.code = 'VAL-09';
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
