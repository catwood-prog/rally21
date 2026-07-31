-- MN3 — the insight layer: contrast cards, dark-shipped behind a kill switch.
--
-- "in your words" (what someone declared) next to "what we've seen" (what
-- their behaviour actually did), where the two disagree. MN2 built the two
-- lanes and was forbidden from merging them; this is the one card allowed to
-- put them side by side, and it never merges them either — it shows both,
-- labelled, and asks.
--
-- ------------------------------------------------------------------
-- JOB 1 — THE MAPPING, AND WHY IT HAS EXACTLY ONE ROW
--
-- The mapping is question family -> behavioural metric, and the section's own
-- instruction is that it exists ONLY where a fair comparison genuinely does:
-- "sparse is honest; a forced mapping is a future false claim." Applied
-- strictly, with three clauses, the whole 130-row bank yields one pair.
--
-- The three clauses a pair must pass:
--   (1) SAME CONSTRUCT. The declared thing and the measured thing are the
--       same quantity, not a proxy of a proxy.
--   (2) NO LEAKAGE. Rally observes essentially the WHOLE of the declared
--       behaviour, not a keyhole onto a life mostly lived off-app. This is
--       the clause that kills nearly everything: a null result measured
--       through a keyhole is a false claim about a person, which is the
--       exact failure Cat ruled would put the app at risk.
--   (3) A PREDICTED DIRECTION. The declaration says which way the number
--       should point, so disagreement is defined rather than eyeballed.
--
-- THE ONE PAIR THAT PASSES — HAB-15 · weekend vs weekday check-in rate.
--   "On weekends, is it easier to protect the practice or let it slip?"
--   ("protect it" / "let it slip" / "depends on the weekend")
--   The practice lives ENTIRELY inside Rally, so completions are not a
--   sample of the declared behaviour, they are all of it. Cat's ruling,
--   31 July, in session, choosing this over three alternatives.
--
-- WHAT WAS REJECTED, AND WHY — recorded so nobody re-derives it:
--   * ENR-09 (tracked, chips) "what restores your energy fastest" — Rally
--     measures mood, never energy. There is no metric to compare against.
--   * SELF-12 (tracked, chips) "how do you respond to a compliment" — the
--     app holds no compliment behaviour of any kind. No metric exists.
--   * MOOD-09 (tracked, chips) "what lifts your mood fastest" — only the
--     "heard" value is even proxy-observable (mood on days the circle
--     answered you). Rejected on MEASURED data, not principle: contact days
--     per account over three weeks are 0, 1, 1, 2 and 5 (one account has
--     none at all), and the most active account recorded mood 5 on all 21
--     of its days, sd 0.00. The split cannot be populated and the outcome
--     cannot vary.
--   * CON-10 and STR-03 (tracked) — short_text, excluded by hallucination
--     law clause 2. They may be quoted verbatim, never detected on.
--   * CON-14, MOOD-07, MOOD-12, CON-11 and the rest — "when you're
--     struggling", "when you feel low", "which moods you let people see"
--     are life states. Clause 2 fails: Rally sees in-app contact only.
--   * HAB-10 "when do you fit the practice into a workday" — passes 1 and
--     3, fails 2 by a little: mapping "before work" to an hour band assumes
--     conventional working hours we do not know. Offered to Cat, not taken.
--
-- ------------------------------------------------------------------
-- THE FLOORS, PROPOSED FROM THE LIVE DISTRIBUTION (the section forbids
-- trusting a figure written in a prompt, including its own):
--
--   declared side   >= 3 answers of the SAME value among the last 4 asks of
--                   the question, all 3 inside 90 days. This is the existing
--                   3-of-4 chip-trait precedent (CHIP_TRAIT_MIN_EVIDENCE /
--                   CHIP_TRAIT_WINDOW), reused rather than reinvented.
--   observed side   >= 14 observed days total (the section's floor), AND
--                   >= 8 weekend days, AND >= 20 weekday days. Measured
--                   reason: the live cohort's biggest weekend/weekday gap
--                   today is 0.214, and it sits on FOUR weekend days, where
--                   one day moves the rate by 0.25. Eight weekend days is
--                   the point at which a single day stops being able to
--                   manufacture the threshold on its own.
--   threshold       gap >= 0.25 IN THE DIRECTION THAT DISAGREES. Live gaps
--                   run +0.024, -0.033, -0.096, -0.119, -0.214, +0.167 over
--                   three-week spans, so 0.25 fires for nobody on today's
--                   data, which is correct: this is what shipped dark means.
--                   At the floor of 8 weekend days, 0.25 is two whole
--                   weekend days, not one.
--
-- SILENCE IS THE DEFAULT AND MERELY FAILING TO CONFIRM IS SILENCE. A card
-- fires only when the number points the OTHER WAY by at least the
-- threshold. "We saw no difference" is never a card: absence of an effect
-- is not evidence someone is wrong about themselves, and saying so would be
-- the correction register the section bans.
--
-- ------------------------------------------------------------------
-- JOB 4 — THE KILL SWITCH (Cat's 31 July ruling SUPERSEDING the 30 July
-- family-only flag). Cards are cohort-wide once a person's own floors are
-- met; the safeguard is one server-side row that turns every card off
-- instantly, with no deploy. It is consulted in BOTH places that matter:
-- compose-blueprint will not generate or store a card while it is off, and
-- get_my_blueprint will not serve one — so flipping it off hides cards that
-- were already written, not just future ones. Default false: this ships
-- dark by construction, not by an empty table.

-- ------------------------------------------------------------------
-- 1. The tracked set gains HAB-15 (Cat's ruling, 31 July, in session).
--
-- Bank metadata, exactly as RA1 designed it — the tracked set is a column on
-- the BANK so Cat can change it without a function rewrite. Written as an
-- assignment over every row, in RA1's own style, so re-running it can only
-- ever restate Cat's six.
--
-- REACHABILITY, STATED PLAINLY BECAUSE IT IS NOT CLOSED BY THIS MIGRATION:
-- RA1's cycle re-asks a question anchored on the person's own LAST ASK, and
-- deliberately refuses to prime a question that has never been asked
-- ("a backfill, not a re-ask"). HAB-15 has never been served to anyone, and
-- it is the ONLY weekend-pool L2 question among 116 weekend-eligible rows,
-- so the ordinary pool reaches it about 0.2 times per 90 days. Tracking it
-- is necessary and not sufficient: until it gets a first ask, the cycle has
-- no anchor and this detector correctly yields nothing. Closing that is an
-- ENGINE change (prime a never-asked tracked question, or place HAB-15 in
-- the cold-start arc), which MN3's scope edges forbid, so it is REPORTED to
-- Cat rather than done here. It is the same backfill-or-wait decision RA1
-- already owes her for account 8174d14d, enlarged.
update public.questions
   set reask_tracked = coalesce(
         code in ('MOOD-09', 'ENR-09', 'SELF-12', 'STR-03', 'CON-10', 'HAB-15'),
         false);

comment on column public.questions.reask_tracked is
  'RA1: this question is re-asked on a ~30-day cycle, anchored to each '
  'user''s own last ask of it, so its family accumulates history instead '
  'of one frozen answer. Cat''s ruling, 31 July: CS1''s five arc '
  'declarations, plus HAB-15 (MN3), whose answer is the declared side of '
  'the one contrast mapping. Read by get_daily_question; the cycle length '
  'lives there.';

-- ------------------------------------------------------------------
-- 2. The kill switch.

create table if not exists public.app_flags (
  key text primary key,
  enabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);

comment on table public.app_flags is
  'Server-side switches a human flips in the dashboard, with no deploy. '
  'RLS is on with NO policies, so no client role can read or write a row; '
  'only service_role and SECURITY DEFINER functions see them.';

alter table public.app_flags enable row level security;

revoke all on table public.app_flags from public;
revoke all on table public.app_flags from anon;
revoke all on table public.app_flags from authenticated;

insert into public.app_flags (key, enabled, note)
values (
  'contrast_cards_enabled',
  false,
  'MN3 contrast cards. OFF = no card is generated, stored or served, '
  'anywhere, for anyone, including cards already written. Cat''s explicit '
  'later ruling turns this on, after she has reviewed real cards for tone.'
)
on conflict (key) do nothing;

-- ------------------------------------------------------------------
-- 3. JOB 1's detector. SQL, zero LLM, one row per candidate.
--
-- Hallucination law clause 1: the model never computes or asserts a fact.
-- Everything a card can possibly say about a person is a column below, and
-- the validator later checks the model's sentence against these values.
--
-- SECURITY DEFINER taking a user id, so it is service_role ONLY — the
-- security convention's cross-user-leak case exactly.

create or replace function public.detect_contrast_candidates(p_user uuid, p_as_of date)
returns table(
  question_code text,
  metric_key text,
  declared_value text,
  declared_answer text,
  declared_date date,
  declared_dates date[],
  declared_of_last int,
  window_start date,
  window_end date,
  observed_days int,
  weekend_days int,
  weekend_checkins int,
  weekday_days int,
  weekday_checkins int,
  weekend_rate numeric,
  weekday_rate numeric,
  gap numeric,
  disagreement text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The floors, named so a reader can find them. Reasoning in the header.
  c_declared_window_days constant int := 90;
  c_declared_last_asks   constant int := 4;
  c_declared_min         constant int := 3;
  c_observed_min_days    constant int := 14;
  c_weekend_min_days     constant int := 8;
  c_weekday_min_days     constant int := 20;
  c_gap_threshold        constant numeric := 0.25;

  v_declared_answer text;
  v_declared_count int;
  v_declared_dates date[];
  v_declared_last date;
  v_declared_first date;
  v_first_activity date;
  v_window_start date;
  v_observed_days int;
  v_weekend_days int;
  v_weekend_checkins int;
  v_weekday_days int;
  v_weekday_checkins int;
  v_weekend_rate numeric;
  v_weekday_rate numeric;
  v_gap numeric;
  v_disagreement text;
begin
  if p_user is null or p_as_of is null then
    return;
  end if;

  -- ---- declared side: HAB-15, 3 of the last 4 asks, one value, 90 days.
  with asks as (
    select r.local_date, r.question_answer
    from public.reflections r
    join public.questions q on q.id = r.question_id
    where r.user_id = p_user
      and q.code = 'HAB-15'
      and not q.is_archived
      and r.question_skipped = false
      and r.question_answer is not null
      and btrim(r.question_answer) <> ''
      and r.local_date <= p_as_of
    order by r.local_date desc
    limit c_declared_last_asks
  )
  select a.question_answer,
         count(*)::int,
         array_agg(a.local_date order by a.local_date),
         max(a.local_date),
         min(a.local_date)
    into v_declared_answer, v_declared_count, v_declared_dates, v_declared_last, v_declared_first
  from asks a
  group by a.question_answer
  order by count(*) desc, max(a.local_date) desc
  limit 1;

  if v_declared_answer is null or v_declared_count < c_declared_min then
    return;
  end if;

  -- All the supporting answers, not merely the newest, must sit inside the
  -- window. A consistency claim assembled from a 2024 answer and two recent
  -- ones is not a claim about who someone is now.
  if v_declared_first < p_as_of - (c_declared_window_days - 1) then
    return;
  end if;

  -- Only the two DIRECTIONAL values predict anything. "depends on the
  -- weekend" is a real and honest answer that simply cannot disagree with a
  -- number, so it yields nothing, forever, by design.
  if v_declared_answer not in ('protect it', 'let it slip') then
    return;
  end if;

  -- ---- observed side: check-in rate, weekend vs weekday.
  select least(
           (select min(c.local_date) from public.completions c where c.user_id = p_user),
           (select min(r.local_date) from public.reflections r where r.user_id = p_user)
         )
    into v_first_activity;

  if v_first_activity is null then
    return;
  end if;

  -- Days before this person existed are not days they failed to show up on.
  v_window_start := greatest(p_as_of - (c_declared_window_days - 1), v_first_activity);

  with days as (
    select gs::date as d
    from generate_series(v_window_start, p_as_of, interval '1 day') gs
  ),
  marked as (
    select d,
           extract(dow from d)::int in (0, 6) as is_weekend,
           exists (
             select 1 from public.completions c
             where c.user_id = p_user and c.kind = 'self' and c.local_date = d
           ) as checked_in
    from days
  )
  select count(*)::int,
         count(*) filter (where is_weekend)::int,
         count(*) filter (where is_weekend and checked_in)::int,
         count(*) filter (where not is_weekend)::int,
         count(*) filter (where not is_weekend and checked_in)::int
    into v_observed_days, v_weekend_days, v_weekend_checkins, v_weekday_days, v_weekday_checkins
  from marked;

  if v_observed_days < c_observed_min_days
     or v_weekend_days < c_weekend_min_days
     or v_weekday_days < c_weekday_min_days then
    return;
  end if;

  v_weekend_rate := round(v_weekend_checkins::numeric / v_weekend_days, 3);
  v_weekday_rate := round(v_weekday_checkins::numeric / v_weekday_days, 3);
  v_gap := round(v_weekend_rate - v_weekday_rate, 3);

  -- Disagreement only, and only at size. Confirmation is silence; so is a
  -- gap that merely fails to confirm.
  if v_declared_answer = 'protect it' and v_gap <= -c_gap_threshold then
    v_disagreement := 'weekends_quieter';
  elsif v_declared_answer = 'let it slip' and v_gap >= c_gap_threshold then
    v_disagreement := 'weekends_holding';
  else
    return;
  end if;

  return query select
    'HAB-15'::text,
    'weekend_vs_weekday_checkin_rate'::text,
    v_declared_answer,
    v_declared_answer,
    v_declared_last,
    v_declared_dates,
    v_declared_count,
    v_window_start,
    p_as_of,
    v_observed_days,
    v_weekend_days,
    v_weekend_checkins,
    v_weekday_days,
    v_weekday_checkins,
    v_weekend_rate,
    v_weekday_rate,
    v_gap,
    v_disagreement;
end;
$$;

comment on function public.detect_contrast_candidates(uuid, date) is
  'MN3 job 1. Deterministic contrast detection, zero LLM. Returns at most '
  'one candidate fact sheet per user; every factual element a card can '
  'contain is a column here. service_role only.';

revoke all on function public.detect_contrast_candidates(uuid, date) from public;
revoke all on function public.detect_contrast_candidates(uuid, date) from anon;
revoke all on function public.detect_contrast_candidates(uuid, date) from authenticated;
grant execute on function public.detect_contrast_candidates(uuid, date) to service_role;

-- ------------------------------------------------------------------
-- 4. get_my_blueprint serves the new card type.
--
-- A contrast card is a PATTERN as far as the rest of the system is
-- concerned: it lands in the same ladder, it inherits the not_quite
-- exclusion below, and it uses the same blueprint_responses table for
-- confirm / not-quite. That is deliberate — "a not-quite pins the contrast
-- PAIR via the existing rejected-pattern machinery" works for free, because
-- the pattern_key IS the pair (question + declared value + metric), so a
-- reworded card with the same claim is the same key and can never resurface.
--
-- Return shape changes (new `contrast` column), so drop and recreate rather
-- than CREATE OR REPLACE — B2's own precedent for exactly this.
--
-- Everything above the contrast block is byte-identical to B2's
-- 20260707053925 version.

drop function if exists public.get_my_blueprint();

create function public.get_my_blueprint()
returns table(
  pattern_key text,
  pattern_type text,
  weekday int,
  direction text,
  cutoff_hour int,
  agreement_count int,
  total_count int,
  evidence_rate numeric,
  statement text,
  contrast jsonb
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
  v_latest_content jsonb;
  v_item jsonb;
  v_contrasts_enabled boolean;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(timezone, 'UTC') into v_tz from public.users where id = v_user;
  if v_tz is null then v_tz := 'UTC'; end if;

  drop table if exists tmp_patterns;
  create temporary table tmp_patterns (
    pattern_key text, pattern_type text, weekday int, direction text,
    cutoff_hour int, agreement_count int, total_count int, evidence_rate numeric,
    statement text, contrast jsonb
  ) on commit drop;

  select avg(mood)::numeric into v_overall_mean from public.reflections where user_id = v_user and mood is not null;

  if v_overall_mean is not null then
    select percentile_cont(0.5) within group (order by mood) into v_median
    from public.reflections where user_id = v_user and mood is not null;

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

          insert into tmp_patterns (pattern_key, pattern_type, weekday, direction, agreement_count, total_count, evidence_rate)
          values (
            'weekday_' || w || '_' || v_direction, 'weekday_mood', w, v_direction,
            v_agreement, v_count, round(v_agreement::numeric / v_count, 3)
          );
        end if;
      end if;
    end loop;

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
            and ((extract(hour from created_at) < 12) = v_before_higher) = (mood >= v_median);

        v_time_rate := round(v_time_agree::numeric / v_time_total, 3);
        if v_time_rate >= 0.6 then
          v_direction := case when v_before_higher then 'before_noon_higher' else 'after_noon_higher' end;
          insert into tmp_patterns (pattern_key, pattern_type, direction, agreement_count, total_count, evidence_rate)
          values (
            'time_of_day_' || v_direction, 'time_of_day_mood', v_direction,
            v_time_agree, v_time_total, v_time_rate
          );
        end if;
      end;
    end if;
  end if;

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
      insert into tmp_patterns (pattern_key, pattern_type, cutoff_hour, agreement_count, total_count, evidence_rate)
      values (
        'consistency', 'consistency', v_mode_hour + 1,
        v_cons_agree, v_cons_total, v_cons_rate
      );
    end if;
  end if;

  select content into v_latest_content
  from public.blueprint_versions
  where user_id = v_user
  order by version desc
  limit 1;

  if v_latest_content is not null then
    for v_item in select * from jsonb_array_elements(coalesce(v_latest_content->'patterns', '[]'::jsonb))
    loop
      if (v_item->>'status') in ('surfaced', 'confirmed') then
        insert into tmp_patterns (pattern_key, pattern_type, evidence_rate, statement)
        values (
          v_item->>'key', 'synthesis_pattern',
          coalesce((v_item->>'confidence')::numeric, 0.75),
          v_item->>'statement'
        );
      end if;
    end loop;

    for v_item in select * from jsonb_array_elements(coalesce(v_latest_content->'wants', '[]'::jsonb))
    loop
      if (v_item->>'status') in ('surfaced', 'confirmed') then
        insert into tmp_patterns (pattern_key, pattern_type, evidence_rate, statement)
        values (
          v_item->>'key', 'synthesis_want',
          coalesce((v_item->>'confidence')::numeric, 0.75),
          v_item->>'statement'
        );
      end if;
    end loop;

    -- MN3 — the contrast lane, behind the kill switch. Read here and not
    -- only at write time on purpose: turning the flag off must silence
    -- cards that are ALREADY in someone's document, instantly, with no
    -- deploy and no data change. That is what makes it a kill switch
    -- rather than a feature toggle.
    select coalesce(
             (select f.enabled from public.app_flags f where f.key = 'contrast_cards_enabled'),
             false)
      into v_contrasts_enabled;

    if v_contrasts_enabled then
      for v_item in select * from jsonb_array_elements(coalesce(v_latest_content->'contrasts', '[]'::jsonb))
      loop
        if (v_item->>'status') in ('surfaced', 'confirmed') then
          insert into tmp_patterns (pattern_key, pattern_type, evidence_rate, statement, contrast)
          values (
            v_item->>'key', 'contrast',
            -- How consistent the DECLARATION was (3 or 4 of the last 4),
            -- which is the only "rate" a contrast card honestly has. It
            -- lands in the same 0.75-1.0 band B1's patterns use, so the
            -- ladder's ordering keeps meaning what it meant.
            coalesce((v_item->>'declared_of_last')::numeric / 4, 0.75),
            v_item->>'observed_line',
            v_item
          );
        end if;
      end loop;
    end if;
  end if;

  return query
  select t.pattern_key, t.pattern_type, t.weekday, t.direction, t.cutoff_hour,
         t.agreement_count, t.total_count, t.evidence_rate, t.statement, t.contrast
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
