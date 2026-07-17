-- GS1 (17 July) — the glow goes social (Rally21-Glow-Spec.md §10).
-- Two server pieces, both read-only over the glow computation itself:
--
-- 1. get_glow_for_circle_mates(p_circle_id): the scoped batch read for
--    Who's Here. Circle-mates only, enforced HERE at the database — the
--    caller passes a circle id, never member uuids, so the arbitrary-
--    uuid leak class G4 closed (get_glow_for_user is service_role-only)
--    cannot reappear. The 7-day visibility floor and the away exclusion
--    are applied server-side too: a sub-7 member is ABSENT from the
--    result (indistinguishable from the feature not applying — no
--    visible failure state, and no sub-threshold numbers ever cross the
--    API), and an away member never shows a flame (Glow-Spec §9).
--
-- 2. check_glow_milestone() gains the huddle celebration: when a
--    milestone fires, each of the user's active, non-completed circles'
--    walls gets ONE warm system line (same modelling as the wave — a
--    plain wall_messages row with server-composed copy, so the existing
--    curated reactions attach for free; no notification_outbox rows, no
--    email, no push, ever, from this feature). The monotonic tracker is
--    now the ATOMIC gate (conditional update + FOUND check) so a
--    concurrent double-call can never write a second line — before this
--    the read-then-update pattern had a tiny race window.
--
-- Never retroactive at ship time: this migration writes no rows, and a
-- milestone only ever fires from a check-in (the RPC is invoked by the
-- check-in completion flow). A user whose tracker already covers their
-- passed milestones can never re-fire them (monotonic, unchanged).

-- The visibility floor. One definition server-side; lib/glow.ts carries
-- the hand-synced client copy (GLOW_SOCIAL_VISIBLE_FROM_DAYS) for
-- display copy, same pattern as every other client/edge constant pair.
create or replace function public.get_glow_for_circle_mates(p_circle_id uuid)
returns table(user_id uuid, glow int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_member record;
  v_glow int;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  -- A forged call by a non-member returns NOTHING — not an error, so
  -- the response never confirms the circle even exists.
  if not exists (
    select 1 from public.memberships m
    where m.circle_id = p_circle_id and m.user_id = v_caller
  ) then
    return;
  end if;

  for v_member in
    select m.user_id as member_id
    from public.memberships m
    join public.users u on u.id = m.user_id
    where m.circle_id = p_circle_id
      -- Away members never show the flame (Glow-Spec §9) — excluded at
      -- the database, not just hidden by the client.
      and u.away_since is null
  loop
    select g.glow into v_glow from public.get_glow_for_user(v_member.member_id) g;
    -- The 7-day floor: below it a member is simply absent, never a
    -- zero/grey row.
    if v_glow >= 7 then
      user_id := v_member.member_id;
      glow := v_glow;
      return next;
    end if;
  end loop;
end;
$$;

-- S1/G5 convention: the project default ACL still grants EXECUTE to
-- anon/PUBLIC on new functions — revoke explicitly, then grant.
revoke all on function public.get_glow_for_circle_mates(uuid) from public;
revoke all on function public.get_glow_for_circle_mates(uuid) from anon;
grant execute on function public.get_glow_for_circle_mates(uuid) to authenticated;

-- check_glow_milestone — G3's function, recreated with (a) the atomic
-- tracker gate and (b) the huddle wall lines. Signature, return value,
-- and the in-app celebration contract are unchanged.
create or replace function public.check_glow_milestone()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_glow int;
  v_already int;
  v_milestone int;
  v_name text;
  m int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select glow into v_glow from public.get_my_glow();
  select max_glow_milestone_celebrated into v_already from public.users where id = v_user;

  v_milestone := null;
  foreach m in array array[7, 21, 50, 100, 365] loop
    if m <= v_glow and m > v_already then
      v_milestone := m;
    end if;
  end loop;

  if v_milestone is null then
    return null;
  end if;

  -- The atomic gate: only the ONE call that actually advances the
  -- tracker celebrates — a concurrent duplicate finds no row to update
  -- and returns null, so the wall lines below can never double-write.
  update public.users
  set max_glow_milestone_celebrated = v_milestone
  where id = v_user and max_glow_milestone_celebrated < v_milestone;
  if not found then
    return null;
  end if;

  insert into public.journal_facts (user_id, circle_id, kind, body, local_date)
  values (
    v_user, null, 'glow_milestone',
    'hit ' || v_milestone || ' days glowing on ' || to_char(now(), 'FMMonth FMDD, YYYY'),
    (now() at time zone 'utc')::date
  );

  -- GS1: one warm line on each of this member's active circles' walls —
  -- the same modelling as the wave (a plain wall_messages row, copy
  -- composed server-side; matches constants/strings.ts's
  -- glowSocialWallLine reference copy verbatim). Completed/archived
  -- circles stay quiet. Exactly-once is inherited from the atomic gate
  -- above. Pride-only copy; a reset is never announced anywhere.
  select coalesce(name, 'someone in your circle') into v_name from public.users where id = v_user;

  insert into public.wall_messages (circle_id, user_id, body)
  select ms.circle_id, v_user,
         v_name || ' has been glowing ' || v_milestone || ' days 🔥'
  from public.memberships ms
  join public.circles c on c.id = ms.circle_id
  where ms.user_id = v_user
    and c.is_active
    and c.completed_at is null;

  return v_milestone;
end;
$$;

revoke all on function public.check_glow_milestone() from public;
revoke all on function public.check_glow_milestone() from anon;
grant execute on function public.check_glow_milestone() to authenticated;
