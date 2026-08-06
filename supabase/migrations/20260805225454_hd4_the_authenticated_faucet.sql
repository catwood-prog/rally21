-- HD4 job 3, 5 Aug — CLOSE THE AUTHENTICATED FAUCET (Cat's in-session
-- ruling: "Both: migration + convention", and "app_caps() + revoke the two
-- triggers").
--
-- THE FINDING (HD3 report-only, re-proved here on the live DB before any
-- DDL). The stored default-ACL row for grantor `postgres`, schema `public`,
-- object type function was
--     {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- so `authenticated=X` was merged onto EVERY newly created function whether
-- or not its migration granted it. S1's per-function block revokes `public`
-- and `anon` and has never named `authenticated`, and HD1's sweep counts
-- anon-executable functions only — so the class was invisible to the
-- standing control. The risk shape is cross-USER, not pre-auth: the next
-- SECURITY DEFINER helper taking a user id would have been callable by any
-- authenticated stranger.
--
-- THE MECHANISM, settled (this is the part HD2's addendum did for anon).
-- `authenticated` arrives through TWO doors and they behave differently:
--
--   (1) Postgres's built-in default grants EXECUTE on every new function to
--       PUBLIC, and `authenticated` is a member of PUBLIC. A new object's
--       ACL is computed as acldefault(owner) with the stored default-ACL
--       entries MERGED ON TOP, and that merge is ADD-only — which is why a
--       revoke stored in the row can never subtract the built-in grant, and
--       why all three of HD2's variants left `=X/postgres` standing. This
--       door is NOT closable from a migration.
--
--   (2) The stored pg_default_acl row's own `authenticated=X` entry. This
--       one IS removable, and — unlike the anon case — the removal HOLDS,
--       precisely because S1's per-function convention already closes door
--       (1) by revoking PUBLIC.
--
-- PROVEN 5 AUG, each inside its own rolled-back transaction, scratch
-- functions created and discarded:
--
--   B  bare arrival, no grants at all
--        {=X/postgres, postgres=X/postgres, authenticated=X/postgres,
--         service_role=X/postgres}          anon=T  authenticated=T
--   C  S1's convention as written today (revoke public, revoke anon, no
--      grant of its own) — THE FAUCET, live:
--        {postgres=X/postgres, authenticated=X/postgres,
--         service_role=X/postgres}          anon=F  authenticated=T
--   D  this migration's revoke + S1's convention — THE FIX:
--        {postgres=X/postgres, service_role=X/postgres}
--                                           anon=F  authenticated=F
--   E  this migration's revoke WITHOUT the per-function public revoke:
--        {=X/postgres, postgres=X/postgres, service_role=X/postgres}
--                                           anon=T  authenticated=T
--   F  HD2's attempt repeated (revoke execute from PUBLIC in the row):
--        the row is unchanged (it never held a PUBLIC entry) and the new
--        function still arrives `=X/postgres`.  anon=T  authenticated=T
--
-- So E is the sentence that matters as much as D: THIS STATEMENT ALONE IS
-- WORTHLESS. Each half is load-bearing and neither works without the other
-- — the convention closes PUBLIC, this row closes authenticated. Cat ruled
-- for both, and S1's per-function block accordingly becomes
--     revoke all on function ... from public;
--     revoke all on function ... from anon;
--     revoke all on function ... from authenticated;
--     grant execute on function ... to authenticated;   -- deliberately
--
-- WHAT THIS CHANGES TODAY: nothing. A default-ACL row governs the NEXT
-- object, never the existing ones — all 66 public functions keep the ACL
-- they already have. What it changes is the arrival posture of function 67.
--
-- WHAT IT DOES NOT CLOSE. The second default-ACL row (grantor
-- `supabase_admin`, schema public) still carries anon=X and authenticated=X.
-- It is not consulted here — all 66 public functions are owned by
-- `postgres`, and migrations and the dashboard SQL editor both connect as
-- `postgres`, so only the postgres row applies. Editing it needs ALTER
-- DEFAULT PRIVILEGES FOR ROLE supabase_admin, which needs membership in
-- that role; `postgres` on this project is neither a superuser nor a member
-- (re-measured 5 Aug). Unchanged from HD2's finding, and it only becomes
-- live if something ever creates a public function AS supabase_admin.
--
-- THE ENFORCEMENT is the generated sweep HD4 job 2 added to
-- supabase/security-hardening.integration.test.ts, which flags any
-- authenticated-executable public function outside an explicit allowlist
-- (50 names, cross-checked against the live grants and the client's .rpc(
-- call sites) and excludes trigger functions by mechanism, with a
-- generated test proving each excluded one really does refuse at 0A000.
-- Proven to bite in both directions before this migration was written.

alter default privileges for role postgres in schema public
  revoke execute on functions from authenticated;

-- ---------------------------------------------------------------------
-- THE RETROFIT (Cat: "app_caps() + revoke the two triggers").
--
-- Exactly three of the 66 public functions were authenticated-executable
-- with no migration anywhere granting it — the faucet class, measured by
-- cross-checking every function against every migration's grant lines,
-- drop-aware (a `drop function` resets an ACL that `create or replace`
-- preserves; no function had a drop after its last grant).
-- ---------------------------------------------------------------------

-- app_caps() — a LIVE client RPC (lib/caps.ts). S1's own 7 July migration
-- revoked it from anon and public and granted nothing, so it has worked for
-- a month only because the faucet was open. Nothing breaks today either
-- way; without this line, the first future migration to drop and recreate
-- app_caps would silently take the app away from every signed-in user.
-- Written in the new shape, which is also idempotent against the old one.
revoke all on function public.app_caps() from public;
revoke all on function public.app_caps() from anon;
revoke all on function public.app_caps() from authenticated;
grant execute on function public.app_caps() to authenticated;

-- The other two are TRIGGER functions, and a trigger function refuses a
-- direct call with SQLSTATE 0A000 whatever its ACL says — proven 5 Aug by
-- calling both as a real signed-in account. So these two lines buy no
-- security; they make the catalog say what we mean, which is the whole
-- reason the class was hard to see in the first place.
revoke all on function public.derive_practice_category() from authenticated;
revoke all on function public.share_practice_of_public_circle() from authenticated;
