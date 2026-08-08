-- IL2 job 1, 8 Aug — THE PROJECT'S FIRST DELIBERATE anon EXECUTE GRANT
-- COMES BACK OUT. Cat's ruling, 7 August.
--
-- 20260806210159_il1_pre_auth_invite_link_opens.sql is history and stays as
-- written, including its reasoning; this migration states the reversal.
--
-- WHAT THE RULING TURNED ON, and it was not the residuals. The three costs
-- IL1's receipt named were real but small at this cohort size (an
-- unauthenticated index lookup per well-formed call, a timing side channel
-- since "both branches return void" is true of return VALUES and not of
-- WORK, and a code-holder inflating their own daily count to the cap). The
-- ruling turned on what an ALLOWLIST does to the control. HD1's generated
-- sweep answers a boolean today — 0 anon-executable — and a boolean is
-- machine-checkable. With entries in ANON_EXECUTE_ALLOWED it answers "zero
-- except the ones a human judged boring", which is a list needing judgement
-- forever. HD4's own finding was that a whole class stayed invisible
-- because the convention never named the role; an allowlist is a slower
-- version of that same failure, with a human in the loop where the blind
-- spot used to be. Against that, the grant bought invite-link-open counts:
-- a metric with no decision riding on it at seven accounts and one outside
-- tester, where the same question is answerable by asking the person.
-- THE FIRST EXCEPTION TO A HARD RULE IS THE EXPENSIVE ONE.
--
-- WHAT IS DELIBERATELY *NOT* DONE HERE. The function is not dropped and
-- `analytics.invite_link_opens` is not dropped or emptied. Cat ruled the
-- GRANT out, not the machinery. What remains is a SECURITY DEFINER function
-- executable by no client role at all — which is the exact shape a future
-- TRUSTED-CONTEXT caller needs. That caller is named in advance so the next
-- session does not have to re-derive it: `app/j/[code].tsx` is a client
-- route and app.json is "output": "static", so the web app has NO
-- server-side execution on Vercel and nowhere to hold a secret. Anything
-- pre-auth that must WRITE therefore reaches for either an anon grant or a
-- public edge function, and the sanctioned answer is the EDGE FUNCTION
-- (`unsubscribe`, `send-notifications`, `compose-nudges` and
-- `compose-blueprint` already run at verify_jwt = false; an edge function
-- holds the service-role key server-side, can rate-limit, and revokes
-- without a migration). Full reasoning: Rally21-Security-Spec.md, 7 Aug
-- amendment.
--
-- THE RESTING STATE THIS RESTORES is HD4's, measured there as variant D:
--   {postgres=X/postgres, service_role=X/postgres}   anon=F  authenticated=F
-- Both `service_role` and `postgres` are server-side roles — service_role's
-- key is never in the shipped bundle — so this is "no client role", not
-- "nobody". The three revokes are restated rather than assumed: the anon
-- one is the reversal, and the public/authenticated ones re-assert S1's
-- block in the shape HD4 settled, so this file reads as the function's
-- whole current posture rather than as a diff against another file.

revoke all on function public.record_invite_link_open(text) from public;
revoke all on function public.record_invite_link_open(text) from anon;
revoke all on function public.record_invite_link_open(text) from authenticated;
-- No grant back. Deliberate, and the absence is the point of the migration:
-- HD1's sweep goes back to asserting an EMPTY allowlist, which a machine can
-- check without anyone's judgement.

comment on function public.record_invite_link_open(text) is
  'IL1 job 3, DORMANT since IL2 (8 Aug) — tallies one pre-auth open of an '
  'invite link. Executable by NO client role: Cat declined the anon grant on '
  '7 Aug (an allowlist turns a machine-checkable boolean into a standing '
  'human judgement). Kept, not dropped, because this is the shape a future '
  'trusted-context caller needs — the sanctioned one is a public edge '
  'function holding the service-role key, never a client grant.';

comment on table analytics.invite_link_opens is
  'IL1 job 3, DORMANT since IL2 (8 Aug) — pre-auth opens of '
  'rally21.com/j/<code>, one row per code per day. Tally marks only: no ids, '
  'no text beyond the CHECK-shaped code, capped per day. Nothing writes it '
  'today: public.record_invite_link_open() is its only writer and no client '
  'role can execute that. Kept with its rows (0 at the time of this '
  'migration) rather than dropped, so a future trusted-context caller lands '
  'on a table that already exists. Counts, not conclusions.';
