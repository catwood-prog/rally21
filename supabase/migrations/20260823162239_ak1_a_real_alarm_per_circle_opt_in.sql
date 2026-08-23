-- AK1 job 2 (23 Aug, Cat's rulings of 8 Aug) — A REAL ALARM, PER CIRCLE,
-- OPT-IN. The schema half only; the AlarmKit module, the toggle and the
-- recompute are jobs 3-7.
--
-- PER MEMBERSHIP, NOT PER CIRCLE, and the distinction is the whole shape:
-- alarms are PERSONAL and circles are SHARED. Two people in the same
-- circle can want an alarm at different times, or one of them not at all,
-- so the pair cannot live on `circles` — that would make one member's
-- private choice a property of everybody's circle. It does not live on
-- `users` either: that is AL1 phase 1, which is deliberately ONE slot per
-- calendar day whatever the circle count (buildReminderPlan takes no
-- circle input, by construction).
--
-- AK1 IS NOT AL1 PHASE 2 AND MUST NOT BE CONFLATED WITH IT.
--   AL1 phase 1 (LIVE, 29 July) — users.alarm_enabled / users.alarm_time,
--     a personal daily LOCAL NOTIFICATION. UNTOUCHED by this migration.
--     Both features coexist and read different columns.
--   AL1 phase 2 (fenced) — the time-sensitive entitlement. Breaks Focus
--     but NOT the silent switch, and AL1's record says never call it an
--     alarm in copy.
--   AK1 (this) — Apple's AlarmKit, iOS 26+. The first API that lets a
--     non-Apple app ring through Silent AND Focus at Clock-app priority.
--
-- THE COPY LAW INVERTS HERE. AL1's "never call it an alarm" existed
-- because AL1 is not one and the word would have been a lie. AK1
-- genuinely IS an alarm, so it is called an alarm. Do not carry AL1's
-- wording rule across.
--
-- CAT'S RULINGS, 8 Aug, all binding and all expressed below or in job 3:
--   1. OPTIONAL, opt-in PER CIRCLE, DEFAULT OFF, and DISTINCT from
--      nudges. The nudge pipeline keeps its two-a-day cap and is
--      untouched — nothing here writes to notification_outbox, and no
--      alarm ever consumes a nudge slot.
--   2. A CHECKED-IN DAY IS SUPPRESSED. Expressed in the WEEKLY RECURRENCE
--      SET on the device (AlarmKit cancels a whole alarm by id and cannot
--      skip one occurrence), never by cancel-and-re-arm. No column here
--      records suppression: it is recomputed from check-in facts the app
--      already has, so there is no second source of truth to drift.
--   3. The iOS floor question was re-ruled on 23 Aug: HOLD THE FLOOR at
--      15.1 and weak-link. Nothing in this file depends on that.
--
-- NO BACKFILL, and it is structural rather than lucky: alarm_enabled
-- defaults false, so every existing membership reads exactly today's
-- behaviour (no alarm) until someone opts in. There is nothing to carry
-- across.

alter table public.memberships
  add column alarm_enabled boolean not null default false,
  add column alarm_time time null;

-- AL1's constraint shape, copied deliberately. "Enabled with no time" is
-- not a state anything can act on — the device scheduler would have
-- nothing to schedule — so making it unrepresentable means the scheduler
-- never has to defend against it, and a half-written toggle fails loudly
-- at the write instead of quietly producing a person who believes they
-- have an alarm and never gets one. That failure mode is exactly PN2's
-- granted-but-unregistered trap, which job 7 exists to keep closed.
alter table public.memberships
  add constraint memberships_alarm_time_required_when_enabled
    check (alarm_enabled = false or alarm_time is not null);

comment on column public.memberships.alarm_enabled is
  'AK1 — the optional per-circle ALARM (Apple AlarmKit, iOS 26+), default '
  'OFF and opt-in per circle (Cat, 8 Aug). PERSONAL despite living on a '
  'shared-circle join row: it is this member''s choice for this circle, '
  'never the circle''s. TRUE means the device holds ONE recurring alarm '
  'for this membership whose weekday set is recomputed from scratch on '
  'app start, on every preference change and after every check-in. '
  'DISTINCT FROM NUDGES: nothing here touches notification_outbox and no '
  'alarm consumes a nudge slot, so PN1''s two-a-day cap is untouched. NOT '
  'users.alarm_enabled, which is AL1 phase 1 (one personal LOCAL '
  'NOTIFICATION per calendar day, whatever the circle count) and keeps '
  'working unchanged. This one really does ring through Silent and Focus, '
  'so it is called an alarm in copy — AL1''s never-say-alarm rule does '
  'NOT carry across.';

comment on column public.memberships.alarm_time is
  'AK1 — the local time-of-day this member chose for THIS circle''s alarm, '
  'in their own timezone. Required whenever alarm_enabled is true, by '
  'check constraint. Handed to AlarmKit as '
  'Alarm.Schedule.Relative.Time(hour:minute:), which Apple documents as '
  'relative to the device timezone and therefore adjusts across timezone '
  'changes on its own — better than AL1''s hand-rolled wall-clock '
  'arithmetic, and it deliberately sidesteps the OD1-Job20 timezone seam. '
  'NOT circles.time_of_day (when the circle expects to be together), NOT '
  'users.alarm_time (AL1''s personal reminder) and NOT '
  'notification_prefs.nudge_time (the learned nudge''s starting point).';

-- READ EXPOSURE, stated plainly rather than assumed, and it is WIDER than
-- AL1's. The memberships SELECT policy is `is_member_of_circle(circle_id)`
-- with no column-level RLS, so ANY member of a circle can read EVERY
-- column of EVERY membership row in that circle — including whether a
-- circle-mate has an alarm set and at what time. AL1's equivalent note
-- covers users, whose policy is `id = auth.uid() or shares_circle_with(id)`;
-- this table is more permissive, so the honest sentence is longer.
-- Nothing renders it to anyone: this is a statement about the table, not
-- a new surface. If a future section wants alarm times genuinely private
-- it needs a column-level split, not a comment.
comment on constraint memberships_alarm_time_required_when_enabled
  on public.memberships is
  'AK1 — an alarm that is on must know when to ring.';

-- THE WRITER. memberships has NO update policy at all (only "a user can
-- add their own membership row" for INSERT and "members can see who else
-- is in their circles" for SELECT), so every write to this table goes
-- through a SECURITY DEFINER RPC. This follows PA2's finish_my_rally /
-- resume_my_rally shape exactly rather than opening the table, because
-- opening it would let a member write a circle-mate's row — and the
-- SELECT policy above already shows how wide "a member of this circle"
-- reaches.
create or replace function public.set_circle_alarm(
  p_circle_id uuid,
  p_enabled boolean,
  p_time time
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_member_of_circle(p_circle_id) then
    raise exception 'not a member of this circle';
  end if;

  -- OWN ROW ONLY: auth.uid() is not a parameter, so there is no shape of
  -- this call that touches anyone else's membership — finish_my_rally's
  -- guarantee, kept.
  --
  -- Turning it OFF clears the time in the same statement rather than
  -- trusting the caller to pass null. That keeps the check constraint
  -- unviolatable from this path, and it means "off" is one state on disk
  -- instead of two ("off with a stale time" would be a second state the
  -- scheduler would have to interpret). Turning it ON with a null time
  -- deliberately raises the constraint's 23514: that is a client bug, it
  -- is not a sentence for a person, and it must fail loudly.
  update public.memberships
  set alarm_enabled = p_enabled,
      alarm_time = case when p_enabled then p_time else null end
  where circle_id = p_circle_id
    and user_id = auth.uid();
end;
$$;

revoke all on function public.set_circle_alarm(uuid, boolean, time) from public;
revoke all on function public.set_circle_alarm(uuid, boolean, time) from anon;
grant execute on function public.set_circle_alarm(uuid, boolean, time) to authenticated;
