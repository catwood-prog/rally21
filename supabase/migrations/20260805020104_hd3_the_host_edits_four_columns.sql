-- HD3, 5 Aug — the host edits four columns, and no others.
--
-- HD2 proved the practice-visibility exploit rode the circles UPDATE policy
-- and trigger-guarded that one consequence. This closes the door itself.
--
-- THE PREMISE NEEDED CORRECTING FIRST. The policy's `polwithcheck` is NULL,
-- which looks like "no write-side guard at all". It isn't: Postgres reuses
-- the USING expression as the WITH CHECK when an UPDATE policy omits one, so
-- `created_by` has been protected all along. Proven on a real token before
-- this migration was written — a host setting `created_by` to a stranger, or
-- to null, is REFUSED 42501 "new row violates row-level security policy".
-- There is no host handover and no orphaning to close (CLAUDE.md's law holds).
--
-- The real reason a host could rewrite the other seventeen columns is that
-- RLS is ROW-level. A WITH CHECK predicate cannot see OLD, so no policy
-- expression can say "this column did not change". WITH CHECK cannot express
-- the rule; COLUMN-LEVEL UPDATE GRANTS can, and that is the mechanism here.
--
-- What was reachable before this migration, each proven on a real token in a
-- rolled-back transaction, all ACCEPTED:
--   * hidden_from_browse = false — a host UN-HIDES a circle a moderator hid
--     (admin_hide_circle / report_content), which is a moderation bypass.
--   * practice_id — re-point a public circle at a private practice id and
--     HD2's own SECURITY DEFINER trigger publishes a STRANGER's practice
--     (is_shared false -> true). HD2 closed that leak on is_public; the same
--     door reached it through the column next door.
--   * start_date / duration_days — rewrite the day counter every member of
--     the circle is counting by.
--   * completed_at — end the rally for everyone.
--   * is_public — publish a private circle (no edit surface exists; the
--     public/private choice is made once, in create_circle).
--   * invite_code, is_active, rallied_on_at, name, time_of_day.
--
-- THE RULED BOUNDARY (Cat, 5 Aug): the four columns the app actually PATCHes.
--   resource_url      lib/circle.ts setCircleResourceUrl
--   instructions      lib/circle.ts setCircleInstructions
--   closed_to_joins   lib/circle.ts setCircleClosedToJoins
--   duration_minutes  lib/circle-setup.ts setCircleDurationMinutes
-- `name` and `time_of_day` stay host-editable through edit_circle, which is
-- SECURITY DEFINER and owned by postgres — it bypasses RLS and column grants
-- alike, so nothing here touches it. Least privilege on purpose: a future
-- screen that wants to PATCH `name` directly will fail loudly (42501) rather
-- than find the boundary already wider than the product.
--
-- The other ten system-owned columns keep their writers, all of which are
-- SECURITY DEFINER functions owned by postgres and therefore unaffected:
-- create_circle, edit_circle, complete_circle, join_circle_by_code,
-- join_public_circle, leave_circle, remove_member_from_circle,
-- admin_hide_circle, admin_set_report_status, report_content,
-- delete_account_prep. HD2's circles_public_shares_practice trigger is KEPT
-- as defense in depth — its UPDATE arm is now only reachable by those routes.
--
-- Nothing here weakens USING: a member or a stranger still matches zero rows.

-- 1. Say the write-side rule out loud. This changes NO behaviour — it is
--    byte-for-byte what Postgres was already substituting — but it stops the
--    guard being invisible, so a future edit to USING cannot silently change
--    what a host may become.
alter policy "the creator can update their circle" on public.circles
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

-- 2. The column boundary. Revoke the blanket table-level UPDATE, then grant
--    back exactly the four ruled columns.
revoke update on public.circles from authenticated;

-- anon has no UPDATE policy at all, so its writes already matched zero rows;
-- this makes the privilege listing match the intent and moves the refusal
-- from RLS to the grant (Cat ruled 5 Aug).
revoke update on public.circles from anon;

grant update (resource_url, instructions, closed_to_joins, duration_minutes)
  on public.circles to authenticated;
