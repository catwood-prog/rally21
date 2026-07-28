-- PA4 — friend streaks outlive the circle, and milestones reach the wall.
-- Rally21-Personal-Arc-Decision-Memo.md §5.1 and §6; Rally21-Glow-Spec.md
-- §3 (pair formation), §4 (milestones), §5 (what stays forbidden).
--
-- STAMP: PA1 is 20260727220000 and PA2 is 20260727234000. This is
-- 20260728010000 — deliberately after both, since it redefines
-- mark_celebration_seen, whose UNITS PA1 changed (practices, not circle
-- days) and whose ceremony caller PA2 rewrote.

-- =====================================================================
-- 1. get_pair_streaks — the cumulative headline, and pair formation that
--    survives the circle.
-- =====================================================================
-- TWO PROBLEMS, ONE FUNCTION.
--
-- (a) THE NUMBER. The shipped column is the consecutive run, and on
--     27 July it read 0 for all fifteen live pairs — because a run only
--     counts when the pair's last shared day is today or yesterday, and
--     the most recent shared day in the whole cohort was 24 July. A
--     screen of zeros beside your friends' names is the failure memo
--     §5 exists to fix.
--
--     So the headline becomes CUMULATIVE (`days_together`): every day
--     the two of you both qualified, ever. It never falls. The
--     consecutive run survives as `streak`, unchanged in meaning and
--     now a small live flourish beside it — a pair streak is jointly
--     owned, so one person's absence must never destroy a number that
--     was also someone else's (memo §5.1).
--
--     ONE RULEBOOK, unchanged (Glow-Spec §3): a pair day is a day that
--     counted for BOTH people's own glow — the intersection of the two
--     glow_qualifying_days series. Cumulative and run are two readings
--     of that same series, not two rules. Nothing new decides what
--     "counted" means, so covers and away spells keep protecting a
--     friendship exactly as RS2 already made them.
--
--     `days_together` is MONOTONIC by construction: glow_qualifying_days
--     derives shelter capacity from max-glow-ever, which only ever
--     rises, and a rise can only turn a previously-unheld day into a
--     held one. There is no path by which a past shared day stops
--     qualifying, which is what "it never falls" requires.
--
-- (b) PAIR FORMATION. Glow-Spec §3: "you have a friend streak with
--     anyone you share (or have ever shared) a circle with... it
--     survives the shared circle completing." The shipped function
--     derived its pair list from CURRENT memberships of the circle
--     passed in, so a friendship died the moment either person left.
--     That is live, not hypothetical: two circles in this database have
--     zero membership rows and a completions history (someone left
--     "Breath of Fire & Fists of Anger" and "Read before bed" and took
--     the pair streak with them).
--
--     Pair formation is therefore derived from memberships UNION
--     completions. leave_circle hard-deletes the membership row but
--     never touches completions (history belongs to the member), so
--     completions is the only record of a shared circle that survives a
--     departure. Anyone who could possibly have a non-zero number is
--     covered: a qualifying day requires a completions row, so someone
--     who joined, never checked in, and left has nothing to lose.
--
-- HOW THE SECURITY POSTURE IS KEPT — read this before changing the
-- signature.
--
--   * p_circle_id is still required and still gated by
--     is_member_of_circle(). It is now an AUTHORIZATION ANCHOR rather
--     than a scope: you must be a current member of a circle you name
--     before this function will tell you anything at all. A non-member
--     gets the same exception it has always got, and an anon caller
--     cannot reach the function (revoke below).
--   * NO ARBITRARY-UUID READ IS INTRODUCED. The only user identity this
--     function reads FROM is auth.uid(). p_circle_id is never used to
--     select a person, and there is no parameter naming a user — so
--     there is no shape of this call that reads a stranger's day series.
--     The peer list is derived server-side from the caller's own
--     history, exactly as get_glow_for_circle_mates does.
--   * The result widens from "this circle's current members" to "people
--     I have shared a circle with", which is not new information about
--     strangers: every row is someone the caller has demonstrably
--     practised alongside.
--   * Blocks are now excluded in BOTH directions. The shipped function
--     did not filter them, which was harmless while the list was one
--     circle's live roster; once the list spans every circle you have
--     ever been in, a blocked person could surface on a screen they are
--     not on. The wall's own read policy already refuses to show a
--     blocked person's words; this matches it.
--
-- shared_this_circle is the DISPLAY scope, kept separate from the data
-- scope on purpose. Glow-Spec §3 puts the headline "near who's-here,
-- best among the members shown", so the circle screen shows only pairs
-- formed through THIS circle — including someone who has since left,
-- which is the whole point — while the friendship data itself stays
-- app-level as the spec requires.

-- The result gains two columns, so Postgres cannot CREATE OR REPLACE
-- over it ("cannot change return type of existing function") — the drop
-- is required, not tidiness. Nothing else in the schema references this
-- function, so there is no dependency to cascade.
drop function if exists public.get_pair_streaks(uuid);

create function public.get_pair_streaks(p_circle_id uuid)
returns table(
  other_user_id uuid,
  other_name text,
  streak int,
  days_together int,
  shared_this_circle boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if not is_member_of_circle(p_circle_id) then
    raise exception 'not a member of this circle';
  end if;

  return query
  with my_circles as (
    select m.circle_id from public.memberships m where m.user_id = v_me
    union
    select c.circle_id from public.completions c where c.user_id = v_me
  ),
  pairs as (
    select x.other_id,
           bool_or(x.circle_id = p_circle_id) as shared_here
    from (
      select m.user_id as other_id, m.circle_id
      from public.memberships m
      join my_circles mc on mc.circle_id = m.circle_id
      where m.user_id <> v_me
      union all
      select c.user_id as other_id, c.circle_id
      from public.completions c
      join my_circles mc on mc.circle_id = c.circle_id
      where c.user_id <> v_me
    ) x
    group by x.other_id
  ),
  my_days as (
    select gd.d from public.glow_qualifying_days(v_me, current_date) gd where gd.qualifies
  )
  select p.other_id, u.name, s.streak, s.days_together, p.shared_here
  from pairs p
  join public.users u on u.id = p.other_id
  left join lateral (
    with both_days as (
      select od.d
      from public.glow_qualifying_days(p.other_id, current_date) od
      join my_days md on md.d = od.d
      where od.qualifies
    ),
    islands as (
      select d, d - (row_number() over (order by d))::int as grp
      from both_days
    ),
    last_island as (
      select grp from islands order by d desc limit 1
    )
    select
      case when (select max(d) from both_days) >= current_date - 1
        then (select count(*) from islands where grp = (select grp from last_island))
        else 0
      end::int as streak,
      (select count(*) from both_days)::int as days_together
  ) s on true
  where not exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_me and b.blocked_id = p.other_id)
       or (b.blocker_id = p.other_id and b.blocked_id = v_me)
  );
end;
$$;
revoke all on function public.get_pair_streaks(uuid) from public;
revoke all on function public.get_pair_streaks(uuid) from anon;
grant execute on function public.get_pair_streaks(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 1b. The digest's cumulative counterpart.
-- ---------------------------------------------------------------------
-- compose-digest runs as service_role with no auth.uid(), iterating many
-- users' pairs, so it cannot reuse the function above — the same reason
-- get_pair_streak_between exists. This is that function's cumulative
-- twin: same rulebook, parameterized by two explicit user ids and an
-- explicit through-date. Crossing detection stays the digest's own
-- (today's value vs yesterday's), which is why a through-date is a
-- parameter rather than current_date.
create or replace function public.get_pair_days_together_between(
  p_user1 uuid,
  p_user2 uuid,
  p_through date
)
returns int
language sql
security definer
set search_path = public
as $$
  select count(*)::int
  from (
    select d from public.glow_qualifying_days(p_user1, p_through) where qualifies
    intersect
    select d from public.glow_qualifying_days(p_user2, p_through) where qualifies
  ) both_days;
$$;
revoke all on function public.get_pair_days_together_between(uuid, uuid, date) from public;
revoke all on function public.get_pair_days_together_between(uuid, uuid, date) from anon;
revoke all on function public.get_pair_days_together_between(uuid, uuid, date) from authenticated;
grant execute on function public.get_pair_days_together_between(uuid, uuid, date) to service_role;

-- =====================================================================
-- 2. wall_messages gains kind = 'milestone'.
-- =====================================================================
-- Memo §6: a rally milestone is an EVENT the circle gets to celebrate,
-- and the wall is where it lives because celebration needs somewhere to
-- respond and the wall already carries hearts and waves. TN1's Today
-- spot is shown-once and then gone, so it must not be the only home for
-- a 100-practice moment.
--
-- A separate kind rather than reusing 'celebration' (GS1's glow lines):
-- the two are different events on different ladders — a glow milestone
-- is user-level and days-consecutive, a rally milestone is circle-level
-- and practice-counted — and a kind that can be told apart is what lets
-- either be filtered, styled or retired later without touching the
-- other's rows.

alter table public.wall_messages
  drop constraint wall_messages_kind_check;
alter table public.wall_messages
  add constraint wall_messages_kind_check
  check (kind in ('post', 'celebration', 'wave', 'heart', 'milestone'));

-- The recipient pin is unchanged in meaning and restated against the new
-- kind list: recipient_id stays meaningful only on the warmth kinds, so
-- a milestone row can never be addressed at one person.
alter table public.wall_messages
  drop constraint wall_messages_recipient_only_on_warmth;
alter table public.wall_messages
  add constraint wall_messages_recipient_only_on_warmth
  check (recipient_id is null or kind in ('wave', 'heart'));

-- Public to the circle, exactly like 'post' and 'celebration'. WL1's
-- three read guards (global hidden flag, the reporter's own permanent
-- anti-join, blocks) carry over unchanged — they apply to every kind.
drop policy "circle members can read wall messages" on public.wall_messages;
create policy "circle members can read wall messages"
on public.wall_messages
for select
to authenticated
using (
  (
    (kind in ('post', 'celebration', 'milestone') and is_member_of_circle(circle_id))
    or (kind in ('wave', 'heart') and recipient_id = auth.uid())
  )
  and not hidden
  and not exists (
    select 1 from public.reports r
    where r.target_kind = 'wall_message' and r.target_id = wall_messages.id and r.reporter_id = auth.uid()
  )
  and not exists (
    select 1 from public.blocks b
    where b.blocker_id = auth.uid() and b.blocked_id = wall_messages.user_id
  )
);

-- The INSERT policy is deliberately NOT touched. It already pins client
-- authorship to kind = 'post', so 'milestone' is unforgeable from any
-- client: the only writer is the SECURITY DEFINER function below, which
-- composes the sentence itself (S1: a definer function never accepts
-- client-composed content destined for another user's surface).

-- =====================================================================
-- 3. mark_celebration_seen — the milestone reaches the wall, and names
--    the people who started the same day.
-- =====================================================================
-- This is the app's ONE atomic gate for a rally milestone: it is called
-- by the ceremony (p_day = 21) and by the quiet celebration screen
-- (42, 63, ... and the 50/100/365 major stops), and its monotonic
-- last_celebrated_day is what stops any of them firing twice. So it is
-- the only correct place to hang the wall event — anywhere else and a
-- retry, a double effect fire or a second device duplicates the post.
--
-- THE GATE IS NOW GENUINELY ATOMIC. The shipped version read
-- last_celebrated_day into a variable, updated, then compared — two
-- concurrent calls could both read 0 and both insert. That was survivable
-- for a private journal_facts row and is not survivable for a public wall
-- line, so the read-then-compare becomes a conditional UPDATE whose own
-- `found` decides. Behaviour is otherwise identical: `set = p_day where
-- last_celebrated_day < p_day` is exactly what `greatest()` did, and a
-- call that does not advance the marker was already a no-op.
--
-- WHAT DOES NOT HAPPEN HERE, and must never be added (Glow-Spec §5):
-- there is no standing display and no ranked list. One row per milestone
-- crossing, on the wall of the circle it happened in, and nothing that
-- reads everyone's counts side by side.

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

  -- The atomic gate: only the ONE call that actually advances this
  -- member's marker celebrates. A concurrent duplicate finds no row to
  -- update and does nothing at all.
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

  -- The journal fact, unchanged except for its date. It was stamped
  -- (now() at time zone 'utc')::date — the one place in the date system
  -- that skipped the coalesce(timezone,'UTC') pattern used correctly
  -- everywhere else server-side (OD1 job 20, Finding C). Evening
  -- check-ins are this cohort's norm, so a UTC stamp lands on tomorrow
  -- for a US member. Fixed in passing because this function is being
  -- rewritten anyway; it changes a display date and a sort key, nothing
  -- load-bearing.
  if p_kind is not null and p_body is not null then
    insert into public.journal_facts (user_id, circle_id, kind, body, local_date)
    values (v_me, p_circle_id, p_kind, p_body, (now() at time zone v_tz)::date);
  end if;

  -- ── The wall event (memo §6) ─────────────────────────────────────────
  -- SYNCHRONISED RALLIES, and the timezone seam.
  --
  -- Start day is the member's FIRST CHECK-IN in this circle, never their
  -- join date — joining and lurking for three days must not burn the
  -- beginning of your rally (memo §6). kind='self' only, which is PA1's
  -- counting rule and also, not by accident, what keeps this clear of
  -- OD1 job 20's Finding A: a cover copies the COVERING member's
  -- local_date onto the covered row, so a covered row's date is not the
  -- covered person's own reckoning and must never define their start.
  --
  -- "Same day" compares completions.local_date directly. That column is
  -- written from the checking-in device's own live clock, never from the
  -- stored users.timezone column — so this comparison is immune to
  -- Finding B, the stale-stored-timezone seam that bites every server
  -- computed "today". Two members in different timezones who each
  -- started on their own 5 July are synchronised, which is the honest
  -- user-facing meaning of the phrase and the only one that does not
  -- import a seam. Same day only, no fuzzy window (Cat's ruling):
  -- strictness is what makes the moment mean anything.
  --
  -- A co-starter is named only once they have ALSO reached this
  -- milestone. Naming someone who is behind would publish a comparison
  -- between two members' counts, which is the leaderboard §5 forbids
  -- arriving by the back door. So the joint line fires when the pair
  -- COMPLETES — whoever arrives second — and the earlier arrival's own
  -- line was simply solo, which was true when it was written.
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

  -- Copy composed here, from a fixed template interpolating only values
  -- this function looked up itself. Mirrored in constants/strings.ts as
  -- reference copy (wallRallyMilestoneLine / wallRallyMilestoneTogetherLine).
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
