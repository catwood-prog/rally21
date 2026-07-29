-- RLS1-remainder (28 July 2026) — job 0: close the glow_day_states
-- exposure, plus the three ride-alongs Cat nodded at (job 1b).
--
-- JOB 0, THE SECURITY FIX.
-- ED1 found that `glow_day_states(p_user uuid, p_through date)` is
-- SECURITY DEFINER and granted to `authenticated`: any signed-in user
-- could pass ANY uuid and read that person's full day-by-day practice
-- history and pebble balance. Circle-mates' uuids are already in the
-- client (get_glow_for_circle_mates returns them), so this needed no
-- guesswork to exploit. PROVEN LIVE before this migration: a freshly
-- created disposable account, holding a real session token and sharing
-- no circle with anyone, read another live user's history back to
-- 2026-07-04 along with glow 5, pebbles 6, longest_rally 5.
--
-- The exposure is NOT one function. Two thin wrappers sit above it and
-- carry exactly the same hole, so closing only the named function would
-- have moved the leak one hop rather than shutting it:
--
--   get_week_for_user(p_user)  -> glow_day_states, last 7 days
--   get_glow_for_user(p_user)  -> glow, state, pebbles, longest_rally,
--                                 shelter_used/capacity
--
-- Cat ruled all three closed together at launch.
--
-- THE FIX IS THE S1 POSTURE CLAUDE.md ALREADY NAMES: the raw,
-- uuid-taking functions become service_role-only, matching the posture
-- `glow_qualifying_days` and `pair_qualifying_days` were already born
-- with (and `pair_qualifying_days` got right by construction in ED1).
--
-- WHY NOTHING BREAKS — every caller was traced (client `.rpc(` sweep
-- AND a pg_proc body scan, per CL1's lesson that client grep alone
-- proves nothing in this architecture):
--
--   * The client NEVER calls the uuid-taking forms. It calls the
--     zero-arg self-only wrappers only: `get_my_glow()` (the flame),
--     `get_my_week()` (the week row) and `record_my_rally_cliff()`.
--     Each derives its subject from auth.uid() and takes no parameter,
--     so there is no arbitrary-uuid read left to make.
--   * Every in-database caller is a postgres-owned SECURITY DEFINER
--     function, so the privilege check on the inner call is made
--     against postgres (which keeps EXECUTE), not against the caller's
--     role. The definer chain is unaffected by revoking `authenticated`:
--       glow_day_states   <- get_glow_for_user, get_week_for_user,
--                            glow_qualifying_days, pair_qualifying_days,
--                            record_my_rally_cliff
--       get_glow_for_user <- get_my_glow, get_glow_for_circle_mates,
--                            get_coverable_members, get_pebble_candidates,
--                            get_share_card_for_today, gift_pebble
--       get_week_for_user <- get_my_week
--   * The two edge functions that call get_glow_for_user
--     (compose-nudges, send-notifications) use the admin client, which
--     is service_role — explicitly kept below.
--
-- The `revoke ... from public, anon` lines are not decoration: G5's
-- 7 July finding (CLAUDE.md, Security conventions) is that this
-- project's live default ACL still grants EXECUTE on functions to
-- anon/PUBLIC automatically, so the revoke must always be explicit.

revoke all on function public.glow_day_states(uuid, date) from public, anon, authenticated;
grant execute on function public.glow_day_states(uuid, date) to service_role;

revoke all on function public.get_week_for_user(uuid) from public, anon, authenticated;
grant execute on function public.get_week_for_user(uuid) to service_role;

revoke all on function public.get_glow_for_user(uuid) from public, anon, authenticated;
grant execute on function public.get_glow_for_user(uuid) to service_role;

-- The self-only wrappers KEEP their `authenticated` grant — they are the
-- client's real call path and the whole point of the shape. Restated
-- here so a future reader sees the intent rather than inferring it.
grant execute on function public.get_my_glow() to authenticated, service_role;
grant execute on function public.get_my_week() to authenticated, service_role;
grant execute on function public.record_my_rally_cliff() to authenticated, service_role;


-- JOB 1b, RIDE-ALONG 1 — drop memberships.last_wrapped_offer_day.
-- SC3's wrapped-offer marker. Its only writer, `mark_wrapped_offered`,
-- was dropped by CL1; PA1 had already reset every row to 0. Re-counted
-- live for this migration rather than trusted from the prompt: 13
-- membership rows, 0 non-zero, and 0 function bodies / 0 views mention
-- the column. No data is lost that any row still carries.
alter table public.memberships drop column last_wrapped_offer_day;


-- JOB 1b, RIDE-ALONG 2 — drop get_pair_streak_between.
-- G2's digest helper, superseded by PA4 and dead since. Re-grepped for
-- this migration including function bodies (CL1's lesson — a client-side
-- grep cannot prove death in this architecture): 0 pg_proc bodies call
-- it, 0 client files, 0 edge functions. It was already service_role-only,
-- so nothing signed-in loses a call it could make.
drop function if exists public.get_pair_streak_between(uuid, uuid, date);


-- JOB 1b, RIDE-ALONG 3 — wrap is_founder() in the wall_messages delete
-- policy. `is_founder()` is STABLE and zero-arg, exactly the initplan
-- shape RLS1 job 1 wrapped 55 times, but the advisor never flags it
-- (auth_rls_initplan only inspects auth.*/current_setting). Wrapping it
-- as `(select is_founder())` lets Postgres evaluate it once per query
-- instead of once per row. ALTER POLICY, never DROP+CREATE, so the table
-- is never briefly unprotected — RLS1 job 1's method, kept.
--
-- The predicate below is the live pg_policy expression with `is_founder()`
-- rewritten and NOTHING else touched; the sibling clause's
-- `(SELECT auth.uid())` is already job 1's work. Logic is unchanged:
-- is_founder() is zero-arg and row-invariant, so hoisting it out of the
-- per-row loop cannot change any row's verdict.
alter policy "the circle creator or founder can delete wall messages"
  on public.wall_messages
  using (
    (exists (
      select 1 from public.circles c
      where c.id = wall_messages.circle_id
        and c.created_by = (select auth.uid())
    ))
    or (select public.is_founder())
  );
