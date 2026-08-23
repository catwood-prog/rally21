-- CV3 (23 Aug) — THE PERSON HEARS ONCE, ON CLIFF MORNING.
--
-- Cat's ruling of 16 Aug: the friends hear AND the person hears. CV2
-- shipped the friends' half (find_open_ember_windows, spells 2 and 5).
-- This is the person's own half, and it exists because the friend-ask
-- structurally cannot reach a SOLO member — and most live circles are
-- solo. Measured before the ruling: get_glow_for_user's 'embers' state
-- only ever follows an UNSHELTERED break, every real break on the books
-- is a cliff, so a pebble-held person reads 'glowing' straight through
-- day 5 and wakes COLD on day 6 having been told nothing at all.
--
-- WHY THIS IS A FILTER AND NOT A SECOND DERIVATION. The spell
-- arithmetic, the timezone resolution, and the off-by-one against
-- glow_day_states' c_max_gap_sheltered all stay where CV2 left them, in
-- ember_window_for, which this function CALLS. Everything below is a
-- filter over rows that one definition already returned — exactly the
-- shape CV2 gave find_open_ember_windows, and for the same reason: the
-- notice can never claim a cliff on a morning the circle screen would
-- still offer a cover for. This function does NO date arithmetic of its
-- own beyond `+ 1`, which is "the morning after the missed day" by
-- ember_window_for's own definition of missed_local_date.
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
  -- tomorrow the cliff.
  if v_window.spell_day <> 5 then
    return;
  end if;

  -- THE COVER GUARD, personal where ember_window_for's is per-circle. A
  -- cover (or an away day) landing on the missed day resets v_gap_len
  -- in glow_day_states for the WHOLE person, so there is no cliff
  -- tomorrow and nothing to say. ember_window_for only ever sees the
  -- one circle it was asked about, so somebody covered in one circle of
  -- two would still surface an open window from the other.
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

  missed_local_date := v_window.missed_local_date;
  spell_day := v_window.spell_day;
  return next;
end;
$$;

comment on function public.cliff_window_for(uuid) is
  'CV3 — is today this person''s cliff morning? A filter over ember_window_for (spell 5 only), made personal: any cover or away day on the missed date, or their own check-in this morning, closes it. Read by compose-nudges only.';

-- S1: the explicit revoke is the ONLY control (HD2 job 4, 4 Aug) — a new
-- function emerges EXECUTE-able by PUBLIC, which anon inherits, and no
-- default-privileges setting can close that door. Both revokes are
-- named, in the same migration that creates the function. The grant
-- matches ember_window_for's own ACL exactly: nothing client-facing
-- calls this, only the composer running as service_role.
revoke all on function public.cliff_window_for(uuid) from public;
revoke all on function public.cliff_window_for(uuid) from anon;
grant execute on function public.cliff_window_for(uuid) to service_role;

-- The new outbox kind. Additive: every existing kind stays exactly as
-- it was, and 'ember_nudge' is deliberately left in place rather than
-- repurposed (see the section report — zero rows all time, but its
-- 'embers'-state branch and its dedicated send-time staleness check are
-- both still live code with their own meaning).
alter table public.notification_outbox
  drop constraint notification_outbox_kind_check;

alter table public.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind = any (array[
    'nudge_daily'::text,
    'social_digest'::text,
    'friend_nudge'::text,
    'ember_nudge'::text,
    'rest_rejoin'::text,
    'ember_ask'::text,
    'covered_notice'::text,
    'cliff_notice'::text
  ]));
