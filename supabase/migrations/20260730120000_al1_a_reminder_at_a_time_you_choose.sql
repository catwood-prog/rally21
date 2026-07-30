-- AL1 phase 1 (30 July, Cat's ruling 27 July) — a reminder at a time you
-- CHOOSE, rather than a time the app infers.
--
-- USER-LEVEL, NOT PER-MEMBERSHIP, and this AGREES with ON2 rather than
-- contradicting it: the personal layer is once-daily and app-level, so a
-- practice time is a fact about the PERSON's day, not about one circle.
-- The circle already declares its own time in circles.time_of_day, which
-- is a different thing serving a different job (when the circle expects
-- to be together), and NS1's notification_prefs.nudge_time is a third
-- thing again (a starting point for the LEARNED nudge). An earlier draft
-- of AL1 put this pair on memberships and was overruled by Cat on 27
-- July; this comment exists so nobody restores it from git history.
--
-- The build consequences of the personal shape are all simplifications:
-- one column pair instead of two, ONE scheduled notification a day
-- whatever the circle count, no reschedule on join or leave, and no
-- coalescing pass for the person sitting in three 08:00 circles.
--
-- WHAT IT GIVES UP, stated honestly: it cannot express 7am meditation and
-- 9pm reading as two reminders, and the notification copy is generic
-- rather than naming a practice. Cat's ruling is that this is the right
-- trade now. A per-membership OVERRIDE can be added later as a pure
-- addition on top of this default; it is deliberately NOT pre-built.
--
-- NOT AN ALARM, and no copy anywhere may call it one: an app cannot ring
-- through a silenced iPhone. Only Apple's Clock app can. What this pair
-- drives is a scheduled LOCAL notification with sound. The
-- time-sensitive entitlement (which breaks through Focus modes) is a
-- NATIVE change and is AL1 phase 2, bundled with build 10 alongside NR1
-- job 3 — deliberately absent here.
--
-- OWN-ROW WRITE, no new RPC: both columns ride the existing own-row users
-- UPDATE policy ("users can update their own profile", id = auth.uid()),
-- exactly as ON2's keep_going_obstacle and SK1's reflections_opt_out do.
-- users has a client UPDATE policy by design, so nothing here needs
-- SECURITY DEFINER, and there is no new function to pin a search_path on
-- or to revoke from anon.
--
-- READ EXPOSURE, stated plainly rather than assumed: the users SELECT
-- policy is `id = auth.uid() or shares_circle_with(id)` and there is no
-- column-level RLS on this table, so a circle-mate can read that you
-- have a reminder set and at what time — the same posture every other
-- profile field on this table already has (keep_going_obstacle,
-- celebrate_birthday, away_since). Nothing renders it to them; this is a
-- statement about the table, not a new surface.
--
-- NO BACKFILL, and it is structural rather than lucky: alarm_enabled
-- defaults false, so every one of the existing accounts reads exactly
-- today's behaviour (no reminder) until someone opts in. There is
-- nothing to carry across.

alter table public.users
  add column alarm_enabled boolean not null default false,
  add column alarm_time time null;

-- "Enabled with no time" is not a state anything can act on — the client
-- scheduler would have nothing to schedule and compose-nudges' hold would
-- have nothing to hold against. Making it unrepresentable here means
-- neither has to defend against it, and a half-written toggle fails loudly
-- at the write instead of quietly producing a person who believes they
-- have a reminder and never gets one.
alter table public.users
  add constraint users_alarm_time_required_when_enabled
    check (alarm_enabled = false or alarm_time is not null);

comment on column public.users.alarm_enabled is
  'AL1 — the optional personal practice reminder, default OFF. One per '
  'PERSON, not per circle (Cat, 27 July). True means the client schedules '
  'a local daily notification at alarm_time, and compose-nudges HOLDS that '
  'day''s NS1 nudge until an interval after it. Never called an alarm in '
  'copy: it cannot ring through a silenced phone.';

comment on column public.users.alarm_time is
  'AL1 — the local time-of-day the person chose to be reminded to '
  'practise, in THEIR timezone (users.timezone). NOT circles.time_of_day '
  '(when a circle expects to be together) and NOT '
  'notification_prefs.nudge_time (the starting point for the learned '
  'nudge). Required whenever alarm_enabled is true, by check constraint.';
