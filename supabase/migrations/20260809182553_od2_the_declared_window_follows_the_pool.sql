-- OD2 job S — MN3's declared window follows the question's POOL.
--
-- MN3 set the declared side's calendar window as one constant:
--
--     c_declared_window_days constant int := 90;
--
-- and 90 was arbitrary in the sense that matters. MN3's own header says
-- it reuses "the existing 3-of-4 chip-trait precedent
-- (CHIP_TRAIT_MIN_EVIDENCE / CHIP_TRAIT_WINDOW)" — but that precedent has
-- NO calendar window at all: CHIP_TRAIT_WINDOW = 4 is a count of ASKS
-- (supabase/functions/compose-blueprint/chip-traits.ts:60). The 3-of-4
-- was inherited; the 90 days was chosen here, by hand.
--
-- Meanwhile the one question the detector reads sits in pool = 'weekend',
-- and that is a property of what the question is ABOUT — "On weekends, is
-- it easier to protect the practice or let it slip?" Asked on a Tuesday it
-- stops being an experience question and becomes a memory question. So the
-- pool cannot be moved to make the arithmetic fit. The window has to.
--
-- CAT RULED 8 AUG: widen the window for weekend-pool questions, and
-- HAB-15 STAYS on pool = 'weekend'. Moving it to pool = 'any' was
-- considered and ruled against — it is the ONLY fair pair that survived
-- MN3's honesty audit, and degrading it for arithmetic would be the MN
-- thread's first relaxed clause. Three answers in 105 days is still three
-- answers: this corrects a UNIT, it does not lower a BAR.
--
-- ------------------------------------------------------------------
-- DERIVED, NOT A SECOND CONSTANT — the section asked which was done and
-- why, and this is the answer. The window is computed from two things the
-- codebase already holds, and nothing else:
--
--   (1) the re-ask cycle, 30 days. RA1 put it in exactly one place,
--       get_daily_question's `v_reask_cycle_days`, and this migration
--       mirrors that number rather than inventing a rival one. If the
--       cycle ever changes, this is the second place to change — said
--       plainly here because nothing enforces it.
--   (2) the days of the week the question's pool allows, read off
--       `public.questions.pool` at call time, not assumed.
--
-- A tracked question comes due exactly 30 days after the person's own last
-- ask, and is then served on the first day its pool allows. For
-- pool = 'any' that is the due day itself, so the period is 30. For
-- pool = 'weekend' the last ask was a Saturday or a Sunday, so the due day
-- is a Monday or a Tuesday, and the next eligible day is the Saturday
-- after it: 35 days or 34. The block below COMPUTES that worst case over
-- every eligible weekday rather than asserting a 5. RE1 measured the same
-- 34-35 days on 6 Aug, independently, by walking the live function.
--
-- The period is then multiplied by (c_declared_last_asks - 1), because the
-- window has to be able to CONTAIN the last four asks: the three
-- qualifying answers may be asks 1, 2 and 4 of that set, and
-- `v_declared_first` is the earliest of the three. Three gaps, not two —
-- and that third gap IS the margin. Without it, a person whose odd answer
-- out happens to be the third of four is silently undetectable.
--
--   pool = 'any'      3 x 30 = 90    <- reproduces MN3's constant EXACTLY
--   pool = 'weekend'  3 x 35 = 105
--
-- That the formula lands back on 90 for an ordinary 30-day question is the
-- check that it is the right formula rather than one fitted to 105. The
-- section's requirement — "a 30-day-cycle question should still be held to
-- 90" — is met by construction, not by a second branch.
--
-- THE OBSERVED WINDOW MOVES WITH IT, DELIBERATELY. `v_window_start` reads
-- the same value, so a weekend-pool card measures behaviour over the same
-- span its declared side was collected over. Leaving the observed side at
-- 90 would set a claim assembled over 105 days beside a number measured
-- over 90 — one card, two spans, which is the fused-populations error the
-- RE1 and WC1 threads each spent sittings unpicking. The observed FLOORS
-- (14 observed days, 8 weekend days, 20 weekday days) and the 0.25 gap
-- threshold are untouched: they are what decides whether there is enough
-- to look at, and this migration does not touch that question.
--
-- NOTHING ELSE CHANGES. The three clauses, the directional-answers-only
-- rule, silence-as-default, and the return shape are byte-identical to
-- MN3's, generated from 20260731234500 by textual substitution rather than
-- retyped. Verified BEFORE writing, so that the thing being edited was
-- known to be the thing that is live: the live `prosrc` is MN3's body with
-- its SQL comment lines stripped, md5 09fa0cbeef0b232339f69e2941bf4fed on
-- both sides.
--
-- SERVER-ONLY. One database function, replaced in place, same signature
-- and same return shape. compose-blueprint reads `window_start` /
-- `window_end` straight off the fact sheet and renders what it is given
-- (supabase/functions/compose-blueprint/contrast.ts), so no client bundle
-- and no edge function changes with this.
--
-- STILL LATENT, REPORTED NOT FIXED (the section says report): the detector
-- is HAB-15-shaped throughout — the code is a literal in three places. Its
-- window is pool-aware now; the mapping is still one row, as MN3 intended.

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
  -- OD2 job S: the declared WINDOW is no longer one of them. It is derived
  -- below, from the re-ask cycle and the question's own pool.
  c_reask_cycle_days     constant int := 30;
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

  -- OD2 job S — the derived window and its two working values.
  v_pool text;
  v_eligible_dow int[];
  v_pool_wait int;
  v_declared_window_days int;
begin
  if p_user is null or p_as_of is null then
    return;
  end if;

  -- ---- OD2 job S: THE DECLARED WINDOW, DERIVED FROM THE POOL.
  --
  -- Read the pool off the bank rather than assuming it, so that if the
  -- question is ever moved the window moves with it and this function does
  -- not have to be found and edited. A missing row falls through to the
  -- unrestricted set, which is the STRICTER of the two answers.
  select q.pool into v_pool
    from public.questions q
   where q.code = 'HAB-15'
   limit 1;

  -- 'weekend' is Saturday and Sunday: the same (0, 6) get_daily_question
  -- uses for v_is_weekend, and the same pair the observed side below uses.
  v_eligible_dow := case when v_pool = 'weekend' then array[0, 6]
                         else array[0, 1, 2, 3, 4, 5, 6] end;

  -- The worst-case wait from a due day to the next day the pool allows,
  -- computed rather than asserted: a tracked question comes due exactly
  -- c_reask_cycle_days after the person's last ask, that last ask was
  -- itself on an eligible weekday, and the question then waits for the
  -- first eligible weekday on or after the due day. Take the longest of
  -- those waits over every weekday a last ask can fall on.
  --   pool = 'any'      every day eligible  -> 0
  --   pool = 'weekend'  Sat + 30d = Mon -> 5; Sun + 30d = Tue -> 4  -> 5
  select max(w.wait) into v_pool_wait
  from unnest(v_eligible_dow) as prev(dow)
  cross join lateral (
    select min(((e.dow - prev.dow - c_reask_cycle_days) % 7 + 7) % 7) as wait
    from unnest(v_eligible_dow) as e(dow)
  ) w;

  -- Times (last asks - 1), because the window must be able to CONTAIN the
  -- last four asks -- the three qualifying answers can be asks 1, 2 and 4.
  --   pool = 'any'      3 * 30 = 90   (MN3's constant, reproduced exactly)
  --   pool = 'weekend'  3 * 35 = 105
  v_declared_window_days :=
    (c_declared_last_asks - 1) * (c_reask_cycle_days + v_pool_wait);

  -- ---- declared side: HAB-15, 3 of the last 4 asks, one value, inside
  -- v_declared_window_days (90 on pool 'any', 105 on pool 'weekend').
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
  if v_declared_first < p_as_of - (v_declared_window_days - 1) then
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
  v_window_start := greatest(p_as_of - (v_declared_window_days - 1), v_first_activity);

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
  'contain is a column here. service_role only. OD2 job S (Cat, 8 Aug): '
  'the declared window is DERIVED from the re-ask cycle and the '
  'question''s pool -- 90 days for pool = ''any'', 105 for '
  'pool = ''weekend'' -- rather than fixed at 90.';

-- Restated rather than assumed. `create or replace` preserves the existing
-- ACL, so these are idempotent no-ops today; they are here because the
-- security convention says a migration touching a function states its
-- grants in full, and because a readback that has to consult a different
-- file is not a readback.
revoke all on function public.detect_contrast_candidates(uuid, date) from public;
revoke all on function public.detect_contrast_candidates(uuid, date) from anon;
revoke all on function public.detect_contrast_candidates(uuid, date) from authenticated;
grant execute on function public.detect_contrast_candidates(uuid, date) to service_role;
