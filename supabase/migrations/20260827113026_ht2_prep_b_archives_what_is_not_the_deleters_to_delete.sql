-- HT2, 27 Aug — prep(b) archives what is not the deleter's to delete.
--
-- FOUND LIVE, NOT HYPOTHESISED, and named in the ruling: "Breath of Fire &
-- Fists of Anger - morning boost" is inactive, memberless, and hosted by a
-- live account. It holds 23 completions of which 14 belong to ANOTHER
-- account, plus 8 wall messages written by that account. Until today,
-- deleting the host's account would have run prep(b) — `delete from
-- circles` — and CASCADED every one of those rows away during the deletion
-- of an account that owns none of them.
--
-- CAT'S RULING (23 Aug): when a memberless hosted circle holds ANY rows
-- that are not the deleter's, prep(b) DEACTIVATES it, sets
-- `closed_to_joins = true`, and keeps every row. A memberless circle
-- holding only the deleter's own rows still deletes outright — today's
-- behaviour, unchanged.
--
-- THE CLOSE-JOINS HALF IS LOAD-BEARING, not decoration. `circles.created_by`
-- is ON DELETE SET NULL (circles_created_by_fkey, read from pg_constraint),
-- so the auth cascade leaves the archived circle hostless; and
-- `join_circle_by_code` ends with `update circles set is_active = true`,
-- so a plain deactivate would let any holder of the invite code mint an
-- ACTIVE circle that nobody can ever host — no creator to edit the link,
-- the instructions, the dose or the joins gate, because HD3
-- (20260805020104) narrowed all four of those columns to the creator.
-- Closing joins BEFORE the auth cascade is what makes the archive inert:
-- join_circle_by_code raises on `v_closed and not v_already_member`, and
-- nobody is a member.
--
-- WHICH ROWS COUNT AS "NOT THE DELETER'S" — the one judgement in this
-- change, and it is narrower than "any row touching a third party".
-- The four probes below ask a single precise question: WOULD THIS ROW
-- OUTLIVE THE ACCOUNT DELETION? prep runs first and the auth cascade runs
-- second (supabase/functions/delete-account/index.ts), so the only rows
-- prep(b) destroys that would otherwise have survived are rows the auth
-- cascade does not itself take. Read from pg_constraint:
--
--   completions.user_id        -> users(id) ON DELETE CASCADE
--   wall_messages.user_id      -> users(id) ON DELETE CASCADE
--   friend_hearts.sender_id    -> users(id) ON DELETE CASCADE
--   friend_hearts.recipient_id -> users(id) ON DELETE CASCADE
--   want_activations.user_id   -> users(id) ON DELETE CASCADE
--
-- So a heart the deleter SENT dies with their account either way, and a
-- heart survives only when BOTH ends are other people — which is why the
-- friend_hearts probe is `and`, not `or`. Archiving on a row that the auth
-- cascade is about to remove anyway would preserve a hostless, joins-closed
-- circle to protect data that no longer exists. The live named case is
-- unaffected by the distinction and proves the point: all 5 of its hearts
-- have the host on one end, so none of them survives the deletion; the
-- archive there is earned by the 14 completions and the 8 wall messages.
--
-- Two further columns were considered and deliberately left out for the
-- same reason, not by oversight: `completions.covered_by` and
-- `wall_messages.recipient_id`. A row whose OWNER is the deleter is taken
-- by the auth cascade regardless of who else it names, and a row whose
-- owner is a third party is already caught by that table's own probe.
--
-- THE FOUR TABLES ARE THE WHOLE POPULATION, measured rather than assumed.
-- Every FK into circles(id) with ON DELETE CASCADE is one of:
-- completions, friend_hearts, memberships, wall_messages, want_activations.
-- memberships needs no probe — branch (b) is DEFINED by there being no
-- member other than the deleter. The remaining children (journal_facts,
-- pebble_gifts, reports) are ON DELETE SET NULL: the circle delete detaches
-- them, it does not destroy them, and they are out of this change's scope.
--
-- CHEAP BY MEASUREMENT: each probe has a circle_id-leading index —
-- completions_circle_id_user_id_local_date_key, wall_messages_circle_recent_idx,
-- idx_friend_hearts_circle_id, idx_want_activations_circle_id.
--
-- WHAT IS DELIBERATELY UNCHANGED: branches (a), (c) and (d) are
-- byte-identical to HT1's shipped definition, read back from pg_proc before
-- this was written rather than copied from the migration file.
-- transfer_circle_host, leave_circle and join_circle_by_code are not
-- touched. No string the app renders changes.

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

  -- (b) hosted circles with no other members.
  --
  -- FIRST, the ones that are wholly the deleter's: delete outright, exactly
  -- as before. The four `not exists` clauses are the only difference from
  -- HT1's statement — each one asks whether a row here would outlive the
  -- account deletion.
  delete from public.circles c
  where c.created_by = p_user_id
    and not exists (select 1 from public.memberships m
                    where m.circle_id = c.id and m.user_id <> p_user_id)
    and not exists (select 1 from public.completions x
                    where x.circle_id = c.id and x.user_id <> p_user_id)
    and not exists (select 1 from public.wall_messages x
                    where x.circle_id = c.id and x.user_id <> p_user_id)
    and not exists (select 1 from public.friend_hearts x
                    where x.circle_id = c.id
                      and x.sender_id <> p_user_id
                      and x.recipient_id <> p_user_id)
    and not exists (select 1 from public.want_activations x
                    where x.circle_id = c.id and x.user_id <> p_user_id);

  -- THEN archive whatever is still standing in that same shape — which,
  -- after the statement above, is exactly the memberless hosted circles
  -- that hold someone else's rows. Stating the leftover this way keeps the
  -- probe list in ONE place; two copies of one rule drifting apart is the
  -- class HT1's own header names. `created_by` is left to the auth
  -- cascade's SET NULL, which is safe precisely because joins are now shut.
  update public.circles c
  set is_active = false,
      closed_to_joins = true
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

-- The ACL is restated rather than assumed. `create or replace` preserves it,
-- but HD4 records that this project's default privileges merge
-- authenticated=X onto functions regardless of what a migration grants, and
-- a caller holding EXECUTE here could run another account's deletion prep.
-- Live ACL before this migration: {postgres=X, service_role=X}.
revoke all on function public.delete_account_prep(uuid) from public;
revoke all on function public.delete_account_prep(uuid) from anon;
grant execute on function public.delete_account_prep(uuid) to service_role;
