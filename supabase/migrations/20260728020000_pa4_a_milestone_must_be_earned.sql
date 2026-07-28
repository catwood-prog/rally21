-- PA4 follow-up — a milestone the member has not reached is not a
-- milestone, and must never reach a wall.
--
-- FOUND LIVE, 28 July 01:29 UTC, within minutes of PA4 shipping. Two
-- rows appeared on two real circle walls:
--
--   "Cathy S has rallied 21 practices 🎉"  (Breath of Fire … morning boost)
--   "Cathy S has rallied 21 practices 🎉"  (Stretching/Yoga moves)
--
-- She had EIGHT practices in the first and FOUR in the second. Both
-- sentences were false, both were public, and both were published by
-- this section's own new code.
--
-- WHAT ACTUALLY HAPPENED. Her client called
-- mark_celebration_seen(circle, 21) — the first-rally ceremony's answer
-- path (app/(app)/journey-gate.tsx). Both routing screens compute the
-- argument correctly via countRallyDays(), so HEAD could not produce
-- this call. A pre-PA1 bundle could: before PA1 the ceremony was gated
-- on the CIRCLE'S AGE, and those two circles were on day 25 and day 24.
-- An expo-updates client downloads a new bundle on one open and applies
-- it on the NEXT, so a cohort tester really can still be running
-- yesterday's JS hours after a publish. She was.
--
-- THE ACTUAL DEFECT IS MINE, NOT HERS AND NOT THE STALE BUNDLE'S.
-- mark_celebration_seen took p_day entirely on trust and composed a
-- PUBLIC SENTENCE from it. A SECURITY DEFINER function may not compose
-- copy for other people's surfaces out of a number it never checked —
-- that is the same rule S1 already states about client-composed
-- content, arriving through a parameter instead of a string. Before
-- PA4 the damage was invisible (a silently wrong private marker); PA4
-- gave that unchecked number a megaphone, so PA4 owns the check.
--
-- Glow-Spec §6 already says where the check belongs: "All streak math
-- in server-side SQL/RPCs... The client displays; it never computes."
-- PA1 moved the ladder's COUNT into a client helper and no server-side
-- function ever re-derived it. This closes that.

create or replace function public.mark_celebration_seen(
  p_circle_id uuid,
  p_day int,
  p_kind text default null,
  p_body text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_tz text;
  v_name text;
  v_rally_count int;
  v_start date;
  v_partners text[];
  v_all_names text;
begin
  if not is_member_of_circle(p_circle_id) then
    raise exception 'not a member of this circle';
  end if;
  if p_kind is not null and p_kind not in ('rally_marker', 'major_stop') then
    raise exception 'invalid celebration kind';
  end if;

  -- THE EARNED CHECK. PA1's counting rule, re-derived here rather than
  -- trusted: distinct local dates with kind='self' in THIS circle.
  -- Covers protect the glow and never advance the rally.
  --
  -- This can never block a legitimate call. Both the ceremony and the
  -- quiet-celebration screen derive p_day from a count read out of this
  -- same table, so the server's count is always >= the client's; the
  -- only calls it refuses are ones describing practices that do not
  -- exist.
  --
  -- Refusing means the marker does NOT advance either, which matters as
  -- much as the silent wall: a marker wrongly set to 21 is precisely
  -- PA1's suppressor — it tells the app this member has already had
  -- their 21st-practice ceremony, so the real one never fires, forever,
  -- with nothing anywhere to show why. Quiet no-op, never an exception:
  -- a stale client that gets an error here would show the person a
  -- failure for something they did nothing wrong in.
  select count(distinct c.local_date) into v_rally_count
  from public.completions c
  where c.user_id = v_me and c.circle_id = p_circle_id and c.kind = 'self';

  if p_day > coalesce(v_rally_count, 0) then
    return;
  end if;

  update public.memberships
  set last_celebrated_day = p_day
  where circle_id = p_circle_id
    and user_id = v_me
    and last_celebrated_day < p_day;
  if not found then
    return;
  end if;

  select coalesce(timezone, 'UTC'), coalesce(name, 'someone in your circle')
  into v_tz, v_name
  from public.users where id = v_me;

  if p_kind is not null and p_body is not null then
    insert into public.journal_facts (user_id, circle_id, kind, body, local_date)
    values (v_me, p_circle_id, p_kind, p_body, (now() at time zone v_tz)::date);
  end if;

  select min(c.local_date) into v_start
  from public.completions c
  where c.user_id = v_me and c.circle_id = p_circle_id and c.kind = 'self';

  select array_agg(u.name order by u.name)
  into v_partners
  from public.memberships m
  join public.users u on u.id = m.user_id
  cross join lateral (
    select min(c.local_date) as started,
           count(distinct c.local_date) as rally_count
    from public.completions c
    where c.user_id = m.user_id and c.circle_id = p_circle_id and c.kind = 'self'
  ) r
  where m.circle_id = p_circle_id
    and m.user_id <> v_me
    and u.name is not null
    and v_start is not null
    and r.started = v_start
    and r.rally_count >= p_day;

  if v_partners is null then
    insert into public.wall_messages (circle_id, user_id, body, kind)
    values (
      p_circle_id, v_me,
      v_name || ' has rallied ' || p_day || ' practices 🎉',
      'milestone'
    );
  else
    v_all_names := array_to_string(array_prepend(v_name, v_partners), ' and ');
    insert into public.wall_messages (circle_id, user_id, body, kind)
    values (
      p_circle_id, v_me,
      v_all_names || ' have each rallied ' || p_day || ' practices 🎉 — they started the same day, '
        || to_char(v_start, 'FMMonth FMDD'),
      'milestone'
    );
  end if;
end;
$$;
revoke all on function public.mark_celebration_seen(uuid, int, text, text) from public;
revoke all on function public.mark_celebration_seen(uuid, int, text, text) from anon;
grant execute on function public.mark_celebration_seen(uuid, int, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Repairing the two rows this already produced.
-- ---------------------------------------------------------------------
-- The wall lines are deleted outright rather than hidden. `hidden` is
-- the moderation flag for something a PERSON wrote and someone
-- reported; this is a false statement the system made about someone,
-- and the honest remedy for a sentence that was never true is that it
-- stops existing. Nobody is being edited — Cathy S did not write these.
--
-- Scoped by kind + body + the two known ids' circles rather than a bare
-- kind sweep, so a genuine milestone posted between the defect and this
-- migration would survive. (There are none: these are the only two
-- milestone rows in the table.)
delete from public.wall_messages
where kind = 'milestone'
  and body like '% has rallied 21 practices %'
  and user_id = (select id from public.users where name = 'Cathy S')
  and circle_id in (
    '2ae9d518-e384-4602-9649-56bc72067335',
    'da4766c3-5f88-441e-b834-1a25912a8e52'
  );

-- And the markers, for PA1's own reason (see its migration's comment):
-- left at 21 these are silent suppressors that would eat this member's
-- REAL 21st-practice ceremony in both circles, permanently. Reset to 0
-- and let the honest number rebuild from `completions`, which needs no
-- backfill. Nothing re-fires today: her counts in these circles are 8
-- and 4, and the first milestone is 21 practices.
update public.memberships
set last_celebrated_day = 0
where last_celebrated_day = 21
  and user_id = (select id from public.users where name = 'Cathy S')
  and circle_id in (
    '2ae9d518-e384-4602-9649-56bc72067335',
    'da4766c3-5f88-441e-b834-1a25912a8e52'
  );
