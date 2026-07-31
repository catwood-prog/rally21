-- FA1 — the first ask: a tracked question with no anchor becomes due once.
--
-- RA1 built the re-ask cycle and deliberately refused to prime a question
-- that had never been asked ("a backfill, not a re-ask"). MN3 then found
-- what that refusal cost and reported it rather than fixing it in its own
-- scope: HAB-15 — the declared side of the ONE fair contrast mapping in a
-- 130-row bank — has never been served to anybody. It is the bank's only
-- weekend-pool L2 among 116 weekend-eligible rows, so the ordinary pool
-- reaches it about 0.2 times per 90 days. MN3's detector was therefore
-- correct AND permanently silent, and Cat's tone review had nothing to
-- review. Tracking a question was necessary and not sufficient; being
-- askable is the missing half.
--
-- CAT'S RULING, 31 July, in session, quoted:
--   "SEED-ONCE, arc sealed."
--
-- She chose it over ARC-ADD (substitute HAB-15 into a cold-start arc day
-- for new users) after this session priced both against the live function.
-- ARC-ADD was not the smaller, partial fix the docs took it for — it is a
-- law break:
--
--   * The arc's day index is `v_cold_start_count + 1`, a COUNT of answered
--     or skipped days, not a calendar date. A person's sixth answered day
--     lands on whichever weekday they happened to answer on.
--   * All 14 arc codes are pool = 'any', and the arc's hard-coded pick
--     applies no pool filter at all — only `is_archived`. It has never
--     served a pool-restricted question, and has no machinery to.
--
--   So "substitute HAB-15 into a weekend arc day" cannot be built: there
--   is no such thing as a weekend arc day. It would either serve a
--   weekend-pool question on a Tuesday — breaking the very pool law the
--   contrast mapping's fairness rests on — or need a calendar condition
--   that destroys the replay determinism CS1 proved. And existing accounts
--   would still never be asked.
--
-- WHAT SEED-ONCE COSTS, STATED BEFORE IT WAS CHOSEN. Seed-once lives in
-- the post-arc branch, beside RA1's cycle, so CS1's arc is untouched and
-- its replay proof still holds. The price is that the five accounts still
-- inside the arc today (answered-or-skipped counts 4, 5, 7, 9 and 11) are
-- not reached until each finishes it. Placing seed-once inside the arc
-- instead was measured and rejected: the arc's only fall-through day is
-- count 13, and count 14 exits to the post-arc branch anyway, so unsealing
-- CS1 would have bought exactly one day.
--
-- ------------------------------------------------------------------
-- THE CHANGE IS THREE LINES, AND THAT IS THE POINT
--
-- Seed-once is not a second mechanism sitting next to the cycle. It is the
-- cycle, with the one clause removed that made an absent anchor fatal:
--
--     -      and la.last_ask is not null
--     -      and la.last_ask <= p_local_date - v_reask_cycle_days
--     +      and (la.last_ask is null
--     +           or la.last_ask <= p_local_date - v_reask_cycle_days)
--
--     -    order by la.last_ask asc, md5(...)
--     +    order by la.last_ask asc nulls first, md5(...)
--
-- `nulls first` is written explicitly rather than left to chance: Postgres
-- defaults ASC to NULLS LAST, which would have parked every first ask
-- behind every re-ask and made the whole change a no-op on any day a
-- re-ask was also due. A never-asked tracked question is the most overdue
-- thing in the set, so it sorts ahead of them.
--
-- Everything else in get_daily_question is byte-identical to
-- 20260731190831 (RA1), which was itself verified byte-identical to the
-- live function before this migration was written (md5 of prosrc,
-- 8778abfe1c26c07a3129b42801164c46). The arc, the follow-up path, the
-- VAL-09 floor, the eligibility pool, scoring, rest logic, interpolation
-- and the reflections upsert are all untouched.
--
-- WHAT THE THREE LINES INHERIT, FOR FREE, BY BEING INSIDE THAT SELECT:
--   pool        HAB-15 is weekend-only, so a first ask waits for the
--               person's next Saturday or Sunday. It cannot appear midweek.
--   L2 cap      every tracked question is L2, so first asks are rate-limited
--               to 3 in any 7 days by the cap already in the predicate.
--   L3 law      inapplicable today (no tracked question is L3) but enforced
--               anyway, so a future L3 tracked question is covered already.
--   SELF rule   no SELF question after a missed day, first ask included.
--   rests       a double-skipped dimension suppresses its first ask too.
--   archived    a struck question is never seeded.
--   determinism same md5(user, date, question) tie-break as the pool.
--   not consumed  a first ask blocked by a cap does not burn: last_ask is
--               still null tomorrow, so it fires on the next allowed day.
--
-- ONCE IS BY CONSTRUCTION. Serving the question writes the reflections row
-- this function already writes at the end of every call, so `la.last_ask`
-- stops being null forever and the ordinary 30-day cycle anchors to that
-- ask. No seeded-flag column, no backfill table, nothing to keep in step —
-- and nothing that can fire twice, because the second call's lateral join
-- returns a date.
--
-- IT PRIMES NOTHING AND BACKDATES NOTHING. RA1's objection to a backfill
-- was that it invents a past the person did not live. This does not: no
-- row is written for any day but today, and the answer, when it comes, is
-- a real answer given on a real day. The question becomes ASKABLE, not
-- answered.
--
-- ------------------------------------------------------------------
-- THE BANK IS NOT TOUCHED BY THIS MIGRATION. The tracked set is MN3's six
-- (MOOD-09, ENR-09, SELF-12, STR-03, CON-10, HAB-15) and stays exactly as
-- MN3 left it. FA1 changes reachability, not membership.
--
-- THE 8174d14d CASE (RA1's owed backfill-or-wait question) is answered by
-- this and nothing else. The account is live as of this migration —
-- checked, not assumed — and holds FIVE never-asked tracked questions, not
-- the four the ledger recorded: CON-10, ENR-09, HAB-15, MOOD-09 and
-- SELF-12, with only STR-03 anchored (15 July). It joined before CS1
-- shipped, so it never met the arc that would have given it the other
-- four. It gets the same three lines as everyone else. Nothing bespoke,
-- no per-account SQL, no data written on its behalf.
--
-- SERVER-ONLY. This migration changes one database function. No client
-- code reads or branches on any of it: the app calls get_daily_question
-- and renders whatever question comes back. There is no bundle to publish,
-- no eas update, no Vercel deploy in this change.

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
    --
    -- FA1 — THE FIRST ASK. Cat's ruling, 31 July: "SEED-ONCE, arc sealed."
    -- RA1 required `la.last_ask is not null`, so a tracked question that
    -- had never been asked had no anchor and could never become due. That
    -- excluded HAB-15 from every account alive (the ordinary pool reaches
    -- it ~0.2 times per 90 days, it being the bank's only weekend-pool L2),
    -- which is what left MN3's detector correctly yielding nothing.
    --
    -- The fix is two tokens, not a second mechanism: `is null` joins the
    -- due test, and the sort is told where nulls go. A never-asked tracked
    -- question is the most overdue thing there is, so `nulls first` — and
    -- it is written explicitly because Postgres defaults ASC to NULLS LAST,
    -- which would have silently parked every first ask behind every re-ask.
    --
    -- ONCE IS BY CONSTRUCTION, NOT BY A COUNTER. Serving the question
    -- writes the reflections row this same function already writes, so
    -- `la.last_ask` stops being null forever and the ordinary 30-day cycle
    -- anchors to that ask with no further code. There is nothing to seed,
    -- nothing to mark as seeded, and nothing that can be seeded twice.
    --
    -- IT PRIMES NOTHING AND BACKDATES NOTHING. RA1 refused to invent a
    -- past answer, and this still refuses: no row is written for a day the
    -- person did not live. The question simply becomes askable, on a real
    -- day, through the same laws every other question passes — which is
    -- why HAB-15 waits for that person's next weekend rather than
    -- appearing on a Tuesday.
    --
    -- MEASURED COST. Every tracked question is L2, so the seeding of a
    -- backlog is rate-limited by the L2 cap already in this select: at
    -- most 3 in any 7 days, and only on days the pool allows. The live
    -- worst case is one account with five never-asked tracked questions
    -- (8174d14d), which drains over about two weeks and then never
    -- recurs. New users are unaffected — the arc gives them five of the
    -- six as first asks, and this reaches the sixth.
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
      and (la.last_ask is null
           or la.last_ask <= p_local_date - v_reask_cycle_days)
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
    order by la.last_ask asc nulls first, md5(v_user::text || p_local_date::text || q.id::text) asc
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

-- The security convention, restated in the migration that redefines the
-- function: the default ACL on this project still grants EXECUTE to
-- anon/PUBLIC on a newly created function, so the revokes are explicit and
-- sit immediately before the grant. Unchanged from RA1.
revoke all on function public.get_daily_question(date) from public;
revoke all on function public.get_daily_question(date) from anon;
grant execute on function public.get_daily_question(date) to authenticated;
grant execute on function public.get_daily_question(date) to service_role;
