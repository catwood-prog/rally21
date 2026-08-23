-- CV3 follow-up (23 Aug) — A CLIFF YOU HAVE ALREADY FALLEN OFF IS NOT A
-- CLIFF, and the first cut of cliff_window_for could not tell the
-- difference.
--
-- MEASURED, not reasoned. A person whose nest was EMPTY when the gap
-- started takes an UNSHELTERED break on the very first missed day: the
-- run is gone immediately, the embers window opens and lapses, and by
-- the spell-5 morning get_glow_for_user reads state 'cold' with
-- ended_at_cliff FALSE. cliff_window_for fired at them anyway, because
-- ember_window_for is deliberately nest-independent (CV2/EM1: a cover
-- can still do re-engagement work even when it rescues no number).
--
-- For CV2's ASK that is right. For THIS notice it is a false promise,
-- and measurably so: with an empty nest, a cover landing on yesterday
-- restores nothing at all — the glow stays cold at 0 — while the same
-- cover for a pebble-held person restores the whole 25-day run. Telling
-- somebody their place is being kept until tonight, on a morning when
-- nothing is keeping it and nothing can, is exactly the misstatement
-- Rally21-Glow-Spec.md §9 forbids.
--
-- THE DISCRIMINATOR IS THE ENGINE'S OWN VERDICT, not a second
-- derivation: get_glow_for_user already publishes ended_at_cliff, which
-- is true precisely when the last break was the pebble running out. At
-- spell 5 that break can only be today's — an older cliff would put the
-- last self check-in further back than five days and the spell filter
-- above would already have returned.
--
-- THIS IS COUPLED TO THE COPY AND IS FLAGGED FOR CAT AT THE JOB-3 STOP.
-- The guard is the conservative direction (FF1): it withholds a notice
-- rather than sending one that overclaims. If she rules a line that
-- makes no claim about a held place — a plain invitation back, true for
-- both people — then this exclusion should be LIFTED deliberately, and
-- the empty-nest person hears the same warm sentence. Nothing else in
-- the section depends on it; it is one `if` and one test.
create or replace function public.cliff_window_for(p_user uuid)
returns table (missed_local_date date, spell_day int)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_circle record;
  v_window record;
  v_found boolean := false;
  v_cliff boolean;
begin
  -- ember_window_for is per-(member, circle) because a COVER is written
  -- against a circle. THIS notice is not: the glow it is about is
  -- personal, and its whole point is reaching someone with nobody else
  -- in the room. So walk the person's live circles only until one
  -- window opens — the spell it reports is personal arithmetic
  -- (v_yesterday - last self check-in ANYWHERE) and is therefore the
  -- same in every circle that gets past that function's own per-circle
  -- guard.
  --
  -- Same circle bound as find_open_ember_windows, deliberately: a
  -- completed circle is warmly archived read-only history
  -- (Rally21-Glow-Spec.md §8) and an inactive one has nobody left in
  -- it. Neither is a place anybody is slipping out of.
  for v_circle in
    select c.id
    from public.circles c
    join public.memberships m on m.circle_id = c.id and m.user_id = p_user
    where c.is_active = true and c.completed_at is null
  loop
    select w.missed_local_date, w.spell_day
      into v_window
      from public.ember_window_for(p_user, v_circle.id) w;
    if found then
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    return;
  end if;

  -- CLIFF MORNING IS SPELL 5 AND NOTHING ELSE — the SAME morning as
  -- CV2's spell-5 ask, so the friends and the person are hearing about
  -- one day rather than two. The off-by-one is argued in full inside
  -- ember_window_for and is not re-derived here: 5 is the last morning
  -- a cover can land and still reset the clock, which is what makes
  -- today the day the run is decided.
  if v_window.spell_day <> 5 then
    return;
  end if;

  -- THE COVER GUARD, personal where ember_window_for's is per-circle. A
  -- cover (or an away day) landing on the missed day resets v_gap_len
  -- in glow_day_states for the WHOLE person, so there is nothing to
  -- say. ember_window_for only ever sees the one circle it was asked
  -- about, so somebody covered in one circle of two would still surface
  -- an open window from the other.
  --
  -- A 'self' row on that day cannot reach here (it would make the spell
  -- 0 and the branch above would have returned), so in practice this
  -- catches exactly 'covered' and 'away'.
  if exists (
    select 1 from public.completions c
    where c.user_id = p_user
      and c.local_date = v_window.missed_local_date
  ) then
    return;
  end if;

  -- ITS OWN GUARD, deliberately NOT folded into the arithmetic above.
  -- The spell counts fully missed days AS OF YESTERDAY, so checking in
  -- THIS MORNING does not move it: without this, the notice would fire
  -- at somebody who has already shown up today. `+ 1` is today in the
  -- person's own timezone by ember_window_for's own definition of
  -- missed_local_date, so no timezone is resolved a second time.
  if exists (
    select 1 from public.completions c
    where c.user_id = p_user
      and c.local_date = v_window.missed_local_date + 1
      and c.kind = 'self'
  ) then
    return;
  end if;

  -- THE SHELTER GUARD — see this migration's header. There is only a
  -- cliff to warn about if a pebble is what has been holding these days.
  select g.ended_at_cliff into v_cliff from public.get_glow_for_user(p_user) g;
  if not coalesce(v_cliff, false) then
    return;
  end if;

  missed_local_date := v_window.missed_local_date;
  spell_day := v_window.spell_day;
  return next;
end;
$$;

comment on function public.cliff_window_for(uuid) is
  'CV3 — is today this person''s cliff morning? A filter over ember_window_for (spell 5 only), made personal: any cover or away day on the missed date, their own check-in this morning, or a run that already broke unsheltered (ended_at_cliff false) closes it. Read by compose-nudges only.';
