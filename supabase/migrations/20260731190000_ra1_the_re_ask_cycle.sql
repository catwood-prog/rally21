-- RA1 — the re-ask cycle: tracked declarations, deliberately repeated.
--
-- MN3 stopped itself on 30 July and was right to. Its declared lane needs
-- 3 answers per question-family per 90 days, and the engine could not
-- deliver 1: every fair question-to-metric family is ONE question, the
-- post-arc pool never re-serves inside a 30-day window, and against a
-- ~120-question pool a given question comes round about 0.75 times per 90
-- days. That is not a tuning problem, it is a mechanism that does not
-- exist. Measured, not assumed — a 90-day replay of a perfect tester
-- against the live pre-RA1 function served CS1's five declarations on days
-- 2, 4, 9, 10, 12 (the arc) and then re-served exactly two of them, MOOD-09
-- on day 68 and SELF-12 on day 70, by luck rather than by design. Three of
-- the five never came back at all.
--
-- So the app asks again, on purpose.
--
-- CAT'S TWO RULINGS, 31 July, in session, quoted:
--   * the tracked set: "CS1's five, exactly" — MOOD-09, ENR-09, SELF-12,
--     STR-03, CON-10.
--   * the cycle: "~30 days".
--
-- WHY THOSE FIVE AND NOT A NEW LIST. They are already the five
-- declarations CS1 put into the cold-start arc (days 2, 4, 9, 10, 12), so
-- the arc answer IS each family's first data point and the cycle only has
-- to deliver the second and third. Starting anywhere else would mean
-- waiting for a first answer before the clock could even start. They also
-- cover all four manual sections — connection (CON-10), energy-recovery
-- (ENR-09), misread (SELF-12), overwhelm-restore (MOOD-09 and STR-03) — so
-- every section of the self-manual gains a question with history rather
-- than a single frozen line.
--
-- THE ASK BUDGET, stated as job 2 required. A tracked question is asked at
-- most once per 30 days, so five of them consume at most 15 of any 90 days
-- — one day in six at steady state. In a new person's FIRST 90 days it is
-- lighter than that: 5 of the 15 are arc days they were going to spend on
-- these questions anyway, leaving 10 re-asks across days 14-90, or one day
-- in eight. The other ~87% of days are the ordinary engine, untouched.
--
-- ------------------------------------------------------------------
-- JOB 1 — the mechanism, and the four choices inside it
--
-- (1) NO NEW STATE. Due-ness is derived, not stored: a tracked question is
--     due when the person's own most recent reflections row for it is 30
--     or more days behind the date being asked about. The answer rows
--     already exist and get_daily_question already writes one the moment
--     it serves a question, so a `reask_schedule` table would only ever
--     hold a number this query can compute. Nothing to drift, nothing to
--     backfill, and a re-ask that is skipped or ignored still moves the
--     clock because the row is still there.
--
--     The one piece of new state is a column on the BANK, not on the
--     person: `questions.reask_tracked`. The tracked set is bank metadata
--     — MN3 needs to know which families carry history, and Cat needs to
--     be able to change the set without a function rewrite. Hard-coding
--     five codes inside this function would have hidden the set from every
--     other reader in the system.
--
-- (2) THE ANCHOR IS THE LAST ASK, NOT THE LAST ANSWER. The section says
--     "anchored to that user's own last answer"; for anyone who answers,
--     those are the same date. They differ only when a re-ask is skipped
--     or left untouched — and anchoring on answers there would make the
--     question due again the very next day, and the day after that, until
--     the person gave in. That is nagging, and the warmth law forbids it.
--     Anchoring on the ask means the app asks about once a month and takes
--     silence for an answer.
--
-- (3) IT REPLACES THE DAY, NEVER ADDS TO IT. The re-ask select runs
--     first inside the post-arc branch; when it finds something, the
--     eligibility pool and the scoring pass never run at all. One question
--     a day, exactly as before, and at most one re-ask among them (LIMIT
--     1) even when several are overdue — the most overdue wins, ties
--     broken by the same md5 the pool uses.
--
-- (4) EXEMPT FROM THE REPEAT WINDOW, SUBJECT TO EVERYTHING ELSE. The
--     30-day no-repeat filter is the one law a re-ask is defined as
--     breaking. Every other law still binds, checked against the same
--     variables the pool uses: the L2 depth cap, the full L3 law (one a
--     week, never after a missed day, never two days running, never on a
--     low-mood run), the no-SELF-after-a-miss rule, the weekday/weekend
--     pool, the dimension rest a double skip earns, and is_archived. A
--     blocked re-ask is not lost: due-ness is derived from a date that
--     does not move, so it simply fires on the next day that allows it.
--
-- DELIBERATELY OUT OF SCOPE, both reported rather than done:
--   * The arc still owns days 1-13. This branch only exists post-arc
--     (v_cold_start_count >= 14), so a slow starter finishes the arc
--     before the cycle can begin.
--   * A person who was past day 14 BEFORE CS1 shipped never met four of
--     these five questions, and a family with no first ask has no anchor,
--     so it is not in the cycle until the ordinary pool happens to serve
--     it once. That is one live account today. Priming a never-asked
--     question as "due" would be a backfill, not a re-ask, and is not in
--     this section's jobs.
--   * The re-ask is worded identically to the first ask. Whether a repeat
--     should say so ("in June you said X — still true?") is a copy
--     decision for Cat, not an engine one.
--
-- Everything outside the re-ask branch — the arc, the follow-up path, the
-- VAL-09 floor, the eligibility pool, scoring, rest logic, interpolation
-- and the reflections upsert — is byte-identical to 20260731034209 (CS1).

alter table public.questions
  add column if not exists reask_tracked boolean not null default false;

comment on column public.questions.reask_tracked is
  'RA1: this question is re-asked on a ~30-day cycle, anchored to each '
  'user''s own last ask of it, so its family accumulates history instead '
  'of one frozen answer. Cat''s ruling, 31 July: CS1''s five arc '
  'declarations. Read by get_daily_question; the cycle length lives there.';

-- coalesce, not a bare IN: the bank still holds retired rows whose `code`
-- is null (the pre-code seed), and `null in (...)` is null, which a NOT
-- NULL column rejects. Written as an assignment over every row rather than
-- a filtered update so re-running it can only ever restate Cat's five.
update public.questions
   set reask_tracked = coalesce(code in ('MOOD-09', 'ENR-09', 'SELF-12', 'STR-03', 'CON-10'), false);

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
  -- RA1: Cat's ruling, 31 July. The one place the cycle length lives.
  v_reask_cycle_days constant int := 30;
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
    -- RA1 JOB 1 — the re-ask cycle, and the only place in this function
    -- that may serve a question the person has already answered.
    --
    -- Due-ness is derived: `la.last_ask` is this person's own most recent
    -- reflections row for this question, and the question is due once that
    -- is v_reask_cycle_days or more behind today. No schedule table, no
    -- cursor, nothing to keep in step with reality.
    --
    -- Every law below is the pool's own law, copied deliberately rather
    -- than referenced, with ONE removed: the 30-day repeat exclusion, which
    -- is the whole point. A re-ask blocked by a cap is not consumed —
    -- last_ask does not move, so it fires on the next day that allows it,
    -- and the most overdue family goes first.
    select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
      into v_selected_id, v_selected_dimension, v_selected_prompt, v_selected_format, v_selected_depth, v_selected_options
    from public.questions q
    join lateral (
      select max(r.local_date) as last_ask
      from public.reflections r
      where r.user_id = v_user
        and r.question_id = q.id
        and r.local_date < p_local_date
    ) la on true
    where q.reask_tracked
      and not q.is_archived
      and la.last_ask is not null
      and la.last_ask <= p_local_date - v_reask_cycle_days
      and (q.pool = 'any' or (q.pool = 'weekend') = v_is_weekend)
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
    order by la.last_ask asc, md5(v_user::text || p_local_date::text || q.id::text) asc
    limit 1;

    -- No re-ask due (the ordinary case, ~5 days in 6): the pool runs
    -- exactly as it always has.
    --
    -- The block below keeps CS1's indentation on purpose, one level short
    -- of where this `if` would put it. Re-indenting ~110 lines would have
    -- made the diff against 20260731034209 look like a rewrite of the
    -- selection engine instead of what it is — one guard placed around an
    -- untouched block. Diffed at the byte level, everything from
    -- `drop table if exists tmp_eligible` to the `limit 1` that closes the
    -- scoring select is unchanged.
    if v_selected_id is null then
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
