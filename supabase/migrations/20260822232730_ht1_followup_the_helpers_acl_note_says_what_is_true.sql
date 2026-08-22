-- HT1 follow-up, 23 Aug — a comment correction, no behaviour change.
--
-- 20260822232558's note beside transfer_circle_host's revokes read "No
-- role gets a grant". That is true of the MIGRATION and false of the
-- resulting ACL, which is exactly the falsified-comment class this ledger
-- keeps catching. Read back from pg_proc immediately after the apply, the
-- helper's ACL is `postgres=X/postgres | service_role=X/postgres`:
-- service_role's EXECUTE arrives from Supabase's own default privileges
-- on schema public, not from anything the migration wrote.
--
-- MEASURED THE SAME MINUTE, and it is why the grant is LEFT ALONE rather
-- than revoked: all 71 functions in `public` are service_role-executable
-- and 0 are anon-executable. Revoking it from this one function would be
-- a one-off deviation from the shape of the whole schema, and it would
-- buy nothing — service_role bypasses RLS, so it can already run
-- `update circles set created_by = ...` directly, with or without this
-- helper. The control that matters is the one that IS asserted:
-- public/anon/authenticated hold no EXECUTE, so no signed-in session can
-- reach it, and the only callers are the two SECURITY DEFINER functions
-- owned by postgres.
--
-- The three revokes are re-stated below because they are idempotent and
-- because a follow-up that only carried prose would leave the registry
-- holding a comment with no statement attached to it.

revoke all on function public.transfer_circle_host(uuid, uuid) from public;
revoke all on function public.transfer_circle_host(uuid, uuid) from anon;
revoke all on function public.transfer_circle_host(uuid, uuid) from authenticated;
