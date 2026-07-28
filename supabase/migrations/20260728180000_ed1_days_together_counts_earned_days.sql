-- ED1 (28 July) — "days together" counts EARNED days.
--
-- Cat's ruling, made as PA3 landed and never executed until now: the pair
-- headline counts earned days only. PA3 made a pebble-held day qualify
-- for the glow (correctly — the glow measures CONTINUITY, memo §9), and
-- glow_qualifying_days is what the pair numbers intersect, so the
-- friendship number silently inherited the pebble. Live before this
-- migration: Catherine S and Louise S read 25 days together on 5 days
-- either of them actually practised alongside the other. The number the
-- memo calls "the one that cannot be taken away" was being handed out by
-- an automatic mechanic.
--
-- ── WHAT COUNTS, AND WHY THAT LINE ──
--
-- A pair day is now a day that qualified for BOTH people WITHOUT a
-- pebble. Practised, covered and away days all still count: those are
-- human acts of continuity — you showed up, a friend showed up for you,
-- or you told the app you were away — while a pebble spends itself from
-- a nest that refills on a clock whether or not anyone did anything.
-- That is the whole distinction: the pair number is about two people,
-- and a pebble involves neither of them.
--
-- This is deliberately NOT the stricter practised-only reading (Cat was
-- offered it). It is also, not by coincidence, the exact number PA4
-- shipped and the number CY1's [21, 50, 75, 100] ladder was ruled
-- against — the cohort's best pair sits at 9, which is what the rungs
-- were chosen from. Excluding the pebble restores that ladder's premise
-- rather than inventing a third scale.
--
-- ── ONE RULEBOOK, TWO READINGS — SO THE RUN MOVES TOO (Cat, in-session) ──
--
-- PA4 wrote the law this migration has to keep: "cumulative and run are
-- two readings of that same series, not two rules." The ruling as typed
-- named only the cumulative headline, but leaving `streak` on the old
-- series would have made that sentence false and put a contradiction on
-- a real screen — 5 of the 11 live pairs would have rendered a flourish
-- larger than the headline it decorates ("you and Louise S, 5 days
-- together · 25 in a row 🔥"). Cat ruled the rulebook, not the column:
-- both readings move to the earned series. The blast radius is one line
-- (PairStreakLine's flourish is the pair run's only reader anywhere).
--
-- The personal glow, the personal run, the week row and the flame are
-- all UNTOUCHED — a pebble still holds a day there, which is what a
-- pebble is for. This migration changes what two people share, nothing
-- about what one person is owed.
--
-- MONOTONICITY SURVIVES. PA4's guarantee ("days_together never falls")
-- rested on glow_qualifying_days only ever turning unheld days into held
-- ones. The earned series is a strict subset defined by the same forward
-- simulation, and no path in glow_day_states turns a self/away/cover day
-- into a pebble day — the classifier tries pebbles last, only on a day
-- nothing else could hold. So the subset only ever grows too.
--
-- STAMP: the newest neighbour is CL1's 20260728160000. This is
-- 20260728180000, after it. It touches no object CL1 touched.

-- ────────────────────────────────────────────────────────────────────
-- 1. The earned series — ONE definition, both readers.
-- ────────────────────────────────────────────────────────────────────
-- A sibling of glow_qualifying_days, not a filter hand-copied into two
-- call sites. PA3's own header says why: the classifier was duplicated
-- three times and drift is this project's most expensive class of bug.
-- Two functions need "qualified without a pebble" and they must never be
-- able to disagree about it, so it is written once.
--
-- The contract deliberately MIRRORS glow_qualifying_days (d, qualifies)
-- so the two call sites read identically apart from the function name —
-- a reviewer can see which series a query is on by reading one word.
--
-- held_by is null on every state except 'held', so `is distinct from
-- 'pebble'` is exactly "not sheltered by a pebble" and never accidental.
create or replace function public.pair_qualifying_days(p_user uuid, p_through date)
returns table(d date, qualifies boolean)
language sql
security definer
set search_path = public
as $$
  select s.d, s.state <> 'none' and s.held_by is distinct from 'pebble'
  from public.glow_day_states(p_user, p_through) s;
$$;

-- Posture copied exactly from glow_qualifying_days, which is service_role
-- only: this takes a bare user id and would be an arbitrary-uuid read of
-- anyone's day series if `authenticated` could reach it. Both callers are
-- SECURITY DEFINER owned by postgres, so they execute this as the owner
-- and need no grant of their own.
revoke all on function public.pair_qualifying_days(uuid, date) from public;
revoke all on function public.pair_qualifying_days(uuid, date) from anon;
revoke all on function public.pair_qualifying_days(uuid, date) from authenticated;
grant execute on function public.pair_qualifying_days(uuid, date) to service_role;

-- ────────────────────────────────────────────────────────────────────
-- 2. The digest's cumulative number.
-- ────────────────────────────────────────────────────────────────────
-- Body unchanged except for the series it intersects. Signature, return
-- type, security posture and grants are all identical, so compose-digest
-- needs no change: its milestone crossing is today-vs-yesterday on
-- whatever this returns, and both sides of that comparison move together.
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
    select d from public.pair_qualifying_days(p_user1, p_through) where qualifies
    intersect
    select d from public.pair_qualifying_days(p_user2, p_through) where qualifies
  ) both_days;
$$;
revoke all on function public.get_pair_days_together_between(uuid, uuid, date) from public;
revoke all on function public.get_pair_days_together_between(uuid, uuid, date) from anon;
revoke all on function public.get_pair_days_together_between(uuid, uuid, date) from authenticated;
grant execute on function public.get_pair_days_together_between(uuid, uuid, date) to service_role;

-- ────────────────────────────────────────────────────────────────────
-- 3. The circle screen's headline — the OTHER computation.
-- ────────────────────────────────────────────────────────────────────
-- THE PROMPT'S PREMISE WAS WRONG AND THIS IS THE CORRECTION. ED1 was
-- written expecting one change at one source, on the belief that the
-- circle screen, the digest and the ladder all call
-- get_pair_days_together_between. They do not: get_pair_streaks computes
-- days_together itself, inline, from its own intersection, because it
-- runs as auth.uid() while the digest runs as service_role over many
-- users (PA4 §1b says so in as many words). Fixing only the digest
-- function would have left every number a person actually SEES — the
-- circle screen headline is the only pair number rendered in the app —
-- reading 25 while the milestone email said 5.
--
-- Both series swap, per the one-rulebook ruling above: my_days and the
-- lateral's both_days, which is the single CTE `streak` and
-- `days_together` are both computed from. Everything else — pair
-- formation from memberships UNION completions, the is_member_of_circle
-- authorization anchor, the two-directional block filter, the
-- shared_this_circle display scope — is byte-for-byte PA4's and is
-- restated here only because plpgsql has no way to patch a body.
--
-- The return type is unchanged, so this replaces rather than drops.
create or replace function public.get_pair_streaks(p_circle_id uuid)
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
    select gd.d from public.pair_qualifying_days(v_me, current_date) gd where gd.qualifies
  )
  select p.other_id, u.name, s.streak, s.days_together, p.shared_here
  from pairs p
  join public.users u on u.id = p.other_id
  left join lateral (
    with both_days as (
      select od.d
      from public.pair_qualifying_days(p.other_id, current_date) od
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
