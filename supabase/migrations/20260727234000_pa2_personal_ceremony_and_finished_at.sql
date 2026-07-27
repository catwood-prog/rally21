-- PA2 — the ceremony becomes personal.
-- Rally21-Personal-Arc-Decision-Memo.md §3, §7, §8, §10 Q1.
--
-- A circle does not have a rally. It is a place with an age, and it
-- persists as long as anyone is in it. So there is no circle-wide
-- decision to race for, and the thing that made the race possible goes.

-- ---------------------------------------------------------------------
-- 1. The circle-level rally decision, deleted.
-- ---------------------------------------------------------------------
-- rally_on_circle was any-member and write-once (`where rallied_on_at is
-- null`), so the FIRST member through the door set the course for
-- everyone and every later arrival got a fait accompli with a single
-- "back to today" button. In Breath of Fire the decision was made by the
-- member who joined on 18 July, eight days into a twenty-two day circle,
-- while the host and Cat both still sat at last_celebrated_day = 0.
--
-- Dropping the FUNCTION is what makes the race unrepresentable: with no
-- RPC there is no path from any client to a circle-wide rally decision,
-- which is stronger than removing the button.
drop function if exists public.rally_on_circle(uuid);

-- THE COLUMN circles.rallied_on_at IS DELIBERATELY KEPT, NOT DROPPED,
-- and this is the ruling PA2 was asked to make and state.
--
-- Three live rows carry it today (Daily Meditation, Breath of Fire &
-- Fists of Anger - morning boost, Stretching/Yoga moves — the section
-- said two, it is three as of 27 July). Those rows are not false: those
-- circles really were rallied on. They are simply no longer load-bearing.
--
-- The decisive reason not to drop it is that the column has READERS
-- OUTSIDE THIS SECTION'S SCOPE, and a DROP would break them at the
-- database level rather than degrade them:
--   * public.get_daily_question (Q1/Q4) reads `c.rallied_on_at is not
--     null` to detect milestone-flavoured days when choosing a question.
--     It is redefined across four migrations and is not PA2's to edit.
--   * supabase/functions/compose-digest reads it for two digest lines.
-- Nothing writes it any more, so both readers simply go quiet for
-- circles created from here on: the question engine stops seeing
-- post-21 milestone days via this route, and the digest stops
-- mentioning a rally-on that can no longer happen. That is a REPORTED
-- consequence for the Q1 and digest owners, not a silent one.

-- ---------------------------------------------------------------------
-- 2. Leaving well: memberships.finished_at (memo §8, §10 Q1).
-- ---------------------------------------------------------------------
-- Not a delete and not a pause. A member who finishes their rally leaves
-- the ACTIVE roster while the row, the history and the journal all
-- survive — and nulling it is the road back. This is deliberately NOT
-- leave_circle, which hard-deletes the membership row and is the only
-- exit a member has today.
--
-- Cat leaned (memo §10 Q1) toward a finished member staying VISIBLE in a
-- settled state rather than vanishing, "because someone quietly
-- disappearing from a huddle is the feeling Rally exists to prevent".
-- PA2's prompt states that as the build instruction, so it is built that
-- way: finished members keep their place in the huddle.
alter table public.memberships
  add column finished_at timestamptz null;

comment on column public.memberships.finished_at is
  'PA2 — when this member finished their own rally in this circle. Non-null = off the active roster but still a member: row, history and journal survive, and nulling it is the road back. Never set by leave_circle, which hard-deletes.';

-- memberships has NO update policy at all (only "a user can add their own
-- membership row" for insert and "members can see who else is in their
-- circles" for select), so every write to it goes through a SECURITY
-- DEFINER RPC. These two follow that shape rather than opening the table.
create or replace function public.finish_my_rally(p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_member_of_circle(p_circle_id) then
    raise exception 'not a member of this circle';
  end if;
  -- Own row only: auth.uid() is not a parameter, so there is no shape of
  -- this call that touches anyone else's membership. Idempotent — a
  -- second call does not move the timestamp, so a double tap cannot
  -- rewrite when someone finished.
  update public.memberships
  set finished_at = now()
  where circle_id = p_circle_id
    and user_id = auth.uid()
    and finished_at is null;
end;
$$;
revoke all on function public.finish_my_rally(uuid) from public;
revoke all on function public.finish_my_rally(uuid) from anon;
grant execute on function public.finish_my_rally(uuid) to authenticated;

-- The road back (memo §8: "nulling it is the road back").
create or replace function public.resume_my_rally(p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_member_of_circle(p_circle_id) then
    raise exception 'not a member of this circle';
  end if;
  update public.memberships
  set finished_at = null
  where circle_id = p_circle_id
    and user_id = auth.uid();
end;
$$;
revoke all on function public.resume_my_rally(uuid) from public;
revoke all on function public.resume_my_rally(uuid) from anon;
grant execute on function public.resume_my_rally(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. complete_circle: creator-only stays; the hardcoded 21 goes.
-- ---------------------------------------------------------------------
-- The journal fact read 'completed 21 days with {circle}' for EVERY
-- member, which was already wrong for a circle completed at any other
-- point and is now wrong twice over: after PA1 the number that means
-- anything is the member's own PRACTICE COUNT, not a circle day, and it
-- differs per member. Each member's fact now states what THEY did.
--
-- Counting rule is PA1's, exactly: distinct local dates with kind='self'
-- in THIS circle. Covers protect the glow and never advance the rally.
create or replace function public.complete_circle(p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_circle_name text;
  v_already_completed timestamptz;
begin
  select created_by, name, completed_at into v_creator, v_circle_name, v_already_completed
  from public.circles where id = p_circle_id;

  if v_creator is null or v_creator <> auth.uid() then
    raise exception 'only the circle creator can complete this circle';
  end if;
  if v_already_completed is not null then
    return;
  end if;

  update public.circles set completed_at = now() where id = p_circle_id;

  insert into public.journal_facts (user_id, circle_id, kind, body, local_date)
  select
    m.user_id,
    p_circle_id,
    'circle_completed',
    case
      when rc.rally_count = 1 then '1 practice with ' || v_circle_name
      else rc.rally_count::text || ' practices with ' || v_circle_name
    end || ' on ' || to_char(now(), 'FMMonth FMDD, YYYY'),
    (now() at time zone 'utc')::date
  from public.memberships m
  cross join lateral (
    select count(distinct c.local_date) as rally_count
    from public.completions c
    where c.user_id = m.user_id
      and c.circle_id = p_circle_id
      and c.kind = 'self'
  ) rc
  where m.circle_id = p_circle_id;
end;
$$;
revoke all on function public.complete_circle(uuid) from public;
revoke all on function public.complete_circle(uuid) from anon;
grant execute on function public.complete_circle(uuid) to authenticated;
