-- HT1, 23 Aug — a creator's leave hands the circle to the earliest
-- remaining member, the way account deletion already does.
--
-- FOUND LIVE, NOT HYPOTHESISED. Cat's throwaway circle (The Wildcard
-- Workout) gained a member, its creator left, and the circle ran on with
-- `created_by` pointing at a departed account: active, one member, and
-- nobody remaining could edit the link or instructions, close it to joins,
-- or set the dose, because HD3 (20260805020104) deliberately narrowed all
-- four of those columns to the creator.
--
-- THE ASYMMETRY, read from pg_proc before this was written:
--   delete_account_prep(a)  transfers hostship to the earliest remaining
--                           member by joined_at when the creator's ACCOUNT
--                           is deleted.
--   leave_circle            was membership-delete plus deactivate-if-empty,
--                           and transferred nothing.
-- Deletion and leaving disagreed about the same departure. Cat's ruling,
-- 21 Aug: AUTO-TRANSFER ON LEAVE, the mirror rule — no prompt, no
-- ceremony, the controls simply appear for the successor.
--
-- ONE RULE, ONE HOME. The successor rule is extracted into
-- `transfer_circle_host` and BOTH callers use it. Two copies of one rule
-- drifting apart is the class this whole ledger exists to prevent
-- (ED1's shared-function pattern), and it is exactly how the two exits
-- came to disagree in the first place.
--
-- WHAT IS DELIBERATELY UNCHANGED:
--   * The solo-creator leave keeps today's exact shape — deactivate,
--     `created_by` intact. There is nobody to hand it to, the row and its
--     invite code survive, and a rejoin flips is_active back (the
--     dormant-circle precedent).
--   * `memberships.role` is not touched. It carries an 'owner' value set
--     at creation, but nothing in the app or the database reads it as a
--     host gate — `created_by` is the only gate, in the RLS policy and in
--     every SECURITY DEFINER host RPC. prep(a) has never touched role
--     either, and the mirror rule means matching prep, not improving on it.
--   * remove_member_from_circle is NOT touched: a host removing someone
--     else is not a leave.
--   * delete_account_prep's behaviour is unchanged in every branch. (a)
--     becomes a loop over the same circles calling the same rule; (b),
--     (c) and (d) are byte-identical.

-- 1. The one rule, in one place.
create or replace function public.transfer_circle_host(
  p_circle_id uuid,
  p_departing_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_successor uuid;
begin
  -- The successor is the earliest remaining member by joined_at, ties
  -- broken by user_id so the choice is deterministic, and the person on
  -- their way out is excluded BY NAME rather than by absence — which is
  -- what lets leave_circle call this BEFORE it deletes the membership row.
  select m.user_id into v_successor
    from public.memberships m
   where m.circle_id = p_circle_id
     and m.user_id <> p_departing_user_id
   order by m.joined_at asc, m.user_id asc
   limit 1;

  -- Nobody remains: hand back null and let the caller decide what that
  -- means (leave_circle deactivates; delete_account_prep never asks,
  -- because its own branch (b) has already excluded this shape).
  if v_successor is null then
    return null;
  end if;

  update public.circles set created_by = v_successor where id = p_circle_id;

  return v_successor;
end;
$function$;

-- This one is INTERNAL: it is called only from inside the two SECURITY
-- DEFINER functions below, both owned by postgres, whose effective user
-- already holds EXECUTE. No role gets a grant, because a caller holding
-- EXECUTE could reassign the host of ANY circle by id. The revokes are
-- explicit and not decorative: CLAUDE.md's security convention records
-- that Postgres's own built-in default grants EXECUTE on every new
-- function to PUBLIC, which anon inherits, and that no default-privileges
-- setting can close it — so this is the only control.
revoke all on function public.transfer_circle_host(uuid, uuid) from public;
revoke all on function public.transfer_circle_host(uuid, uuid) from anon;
revoke all on function public.transfer_circle_host(uuid, uuid) from authenticated;

-- 2. The new caller.
create or replace function public.leave_circle(p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_remaining int;
begin
  -- A departing CREATOR hands the circle on first, so the controls are
  -- already the successor's by the time they are the only one holding
  -- them. Runs before the membership delete; transfer_circle_host returns
  -- null and writes nothing when nobody else remains, which is how the
  -- solo-creator leave keeps its old shape.
  if exists (
    select 1 from public.circles c
     where c.id = p_circle_id and c.created_by = v_user_id
  ) then
    perform public.transfer_circle_host(p_circle_id, v_user_id);
  end if;

  delete from public.memberships
   where circle_id = p_circle_id and user_id = v_user_id;

  select count(*) into v_remaining
    from public.memberships where circle_id = p_circle_id;
  if v_remaining = 0 then
    update public.circles set is_active = false where id = p_circle_id;
  end if;
end;
$function$;

revoke all on function public.leave_circle(uuid) from public;
revoke all on function public.leave_circle(uuid) from anon;
grant execute on function public.leave_circle(uuid) to authenticated;
grant execute on function public.leave_circle(uuid) to service_role;

-- 3. The old caller, now reading the rule from the same place. Branches
--    (b), (c) and (d) are unchanged.
create or replace function public.delete_account_prep(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_circle_id uuid;
begin
  -- (a) hosted circles with other members: transfer host to earliest member
  for v_circle_id in
    select c.id from public.circles c
    where c.created_by = p_user_id
      and exists (select 1 from public.memberships m
                  where m.circle_id = c.id and m.user_id <> p_user_id)
  loop
    perform public.transfer_circle_host(v_circle_id, p_user_id);
  end loop;

  -- (b) hosted circles with no other members: delete outright
  delete from public.circles c
  where c.created_by = p_user_id
    and not exists (select 1 from public.memberships m
                    where m.circle_id = c.id and m.user_id <> p_user_id);

  -- (c) last member but not creator: deactivate, mirroring leave_circle
  update public.circles c
  set is_active = false
  where c.created_by is distinct from p_user_id
    and exists (select 1 from public.memberships m
                where m.circle_id = c.id and m.user_id = p_user_id)
    and not exists (select 1 from public.memberships m
                    where m.circle_id = c.id and m.user_id <> p_user_id);

  -- (d) practices: delete unreferenced customs, orphan the rest
  delete from public.practices p
  where p.created_by = p_user_id
    and not exists (select 1 from public.circles c where c.practice_id = p.id);

  update public.practices set created_by = null where created_by = p_user_id;
end;
$function$;

revoke all on function public.delete_account_prep(uuid) from public;
revoke all on function public.delete_account_prep(uuid) from anon;
grant execute on function public.delete_account_prep(uuid) to service_role;
