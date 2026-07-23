-- ON1 (23 July) — the two-question Day-0 intake.
--
-- Q1 "what would you most like these 21 days to change?" is stored on the
-- USER (one desired change per person): one of the five PT1 practice
-- domains, or 'connection' (answered by the circle itself, not a practice
-- domain). It pre-filters the practice browse.
--
-- Q2 "what usually makes it hard to keep going?" is stored on the
-- MEMBERSHIP (per circle): the obstacle names a mechanic we already
-- shipped, which the Day-0 reflected sentence surfaces.
--
-- Both nullable, both CHECK-constrained to the fixed option sets, no
-- backfill (existing rows stay null). Own-row only: the user column rides
-- the existing own-row users UPDATE policy (like every other profile
-- field); memberships has no client UPDATE policy by design (S1/WL2), so
-- the obstacle is written through a SECURITY DEFINER RPC scoped to the
-- caller's OWN membership row.
--
-- Brand-integrity (ON1 scope edge): these are SELF-REPORTED ("you told
-- us"), and must never feed get_my_blueprint's observed-pattern output or
-- render in the map's "we noticed" voice. Nothing here touches the
-- blueprint — the columns are read only by the onboarding intake + the
-- Day-0 sentence.

alter table public.users
  add column onboarding_desired_change text
    check (
      onboarding_desired_change is null
      or onboarding_desired_change in ('move', 'mind', 'learn', 'make', 'care', 'connection')
    );

alter table public.memberships
  add column keep_going_obstacle text
    check (
      keep_going_obstacle is null
      or keep_going_obstacle in ('forget', 'no_time', 'lose_motivation', 'miss_once', 'alone')
    );

-- Own-row write for the membership obstacle (memberships has no client
-- UPDATE policy — the mark_wall_seen / mark_wrapped_offered pattern). A
-- null p_obstacle is allowed (a warm "skip" leaves it null). The CHECK
-- constraint is the real guard; the explicit check just returns a clean
-- error instead of a constraint violation.
create function public.set_keep_going_obstacle(p_circle_id uuid, p_obstacle text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_obstacle is not null
     and p_obstacle not in ('forget', 'no_time', 'lose_motivation', 'miss_once', 'alone') then
    raise exception 'invalid obstacle';
  end if;
  update public.memberships
  set keep_going_obstacle = p_obstacle
  where circle_id = p_circle_id and user_id = auth.uid();
end;
$$;

revoke all on function public.set_keep_going_obstacle(uuid, text) from public, anon;
grant execute on function public.set_keep_going_obstacle(uuid, text) to authenticated;
