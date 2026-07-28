-- RLS1 (28 July) — the initplan migration. MECHANICAL. NO POLICY LOGIC CHANGES.
--
-- The Supabase performance advisor's `auth_rls_initplan` lint: a bare
-- `auth.uid()` in a policy predicate is re-evaluated ONCE PER ROW. Wrapped
-- as `(select auth.uid())` it becomes an InitPlan — evaluated once per
-- query and reused. Irrelevant at 6 rows, real at 200 users; this is the
-- fix, before strangers arrive.
--
-- ── Why this is safe, not merely believed to be safe ──────────────────
-- `auth.uid()` is declared STABLE and takes no arguments:
--
--     CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
--       LANGUAGE sql STABLE AS $$ ... current_setting('request.jwt.claims') ... $$
--
-- A STABLE, argument-free function returns the same value for every row
-- within a single query by definition, so hoisting it into an InitPlan
-- cannot change which rows a predicate admits. The rewrite is
-- semantics-preserving by construction, not by inspection.
--
-- Every one of the 55 flagged occurrences was checked individually for the
-- one shape that WOULD change meaning — `auth.uid()` sitting in a
-- correlated position where per-row re-evaluation is the point. There is
-- no such occurrence: all 55 are bare scalar calls compared against a
-- column. No policy was adapted; none needed to be.
--
-- ── Why ALTER POLICY and not DROP + CREATE ────────────────────────────
-- ALTER POLICY touches ONLY the expressions. The policy's name, command,
-- PERMISSIVE/RESTRICTIVE class and role list are left untouched by the
-- statement itself, so they cannot drift. It also means there is never an
-- instant where the table sits unprotected, which DROP + CREATE would
-- open.
--
-- Where a policy has a USING clause and no WITH CHECK (the UPDATE policies
-- on circles, practices, reflections and wall_message_reactions), only
-- USING is altered — leaving WITH CHECK null, which is what makes Postgres
-- reuse USING for the check. Naming it explicitly would have changed the
-- policy from "check = using" to "check = a copy of today's using", which
-- is a real difference the next person to edit it would trip over.
--
-- Every predicate below was generated FROM pg_policies on the live
-- database and mechanically rewritten, not retyped by hand — so the text
-- is the database's own deparse with `auth.uid()` substituted, and nothing
-- else.
--
-- Deliberately NOT touched (report-only, per the section brief): the
-- multiple_permissive_policies lints on completions (the two INSERT
-- policies are the cover-a-friend design, not an accident) and the
-- unused_index lints (meaningless at 6 users).

-- ── ask_conversations ────────────────────────────────────────────────
alter policy "a user can close their own ask conversation" on public.ask_conversations
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy "a user can create their own ask conversation" on public.ask_conversations
  with check ((user_id = (select auth.uid())));

alter policy "a user can delete their own ask conversation" on public.ask_conversations
  using ((user_id = (select auth.uid())));

alter policy "a user can read their own ask conversations" on public.ask_conversations
  using ((user_id = (select auth.uid())));

-- ── ask_messages ─────────────────────────────────────────────────────
alter policy "a user can create their own ask messages" on public.ask_messages
  with check ((user_id = (select auth.uid())));

alter policy "a user can read their own ask messages" on public.ask_messages
  using ((user_id = (select auth.uid())));

-- ── blocks ───────────────────────────────────────────────────────────
alter policy "a user can create their own blocks" on public.blocks
  with check ((blocker_id = (select auth.uid())));

alter policy "a user can read their own blocks" on public.blocks
  using ((blocker_id = (select auth.uid())));

alter policy "a user can remove their own blocks" on public.blocks
  using ((blocker_id = (select auth.uid())));

-- ── blueprint_responses ──────────────────────────────────────────────
alter policy "a user can read their own blueprint responses" on public.blueprint_responses
  using ((user_id = (select auth.uid())));

alter policy "a user can save their own blueprint responses" on public.blueprint_responses
  with check ((user_id = (select auth.uid())));

-- ── blueprint_versions ───────────────────────────────────────────────
alter policy "a user can read their own blueprint versions" on public.blueprint_versions
  using ((user_id = (select auth.uid())));

-- ── card_events ──────────────────────────────────────────────────────
alter policy "a user can insert their own card events" on public.card_events
  with check ((user_id = (select auth.uid())));

-- ── circles ──────────────────────────────────────────────────────────
alter policy "signed-in members can create a circle" on public.circles
  with check ((created_by = (select auth.uid())));

alter policy "the creator can update their circle" on public.circles
  using ((created_by = (select auth.uid())));

-- ── completions ──────────────────────────────────────────────────────
alter policy "a member can cover another member's missed day" on public.completions
  with check (((kind = 'covered'::text) AND (covered_by = (select auth.uid())) AND (user_id <> (select auth.uid())) AND is_member_of_circle(circle_id) AND (EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.circle_id = completions.circle_id) AND (m.user_id = completions.user_id)))) AND (local_date = (((now() AT TIME ZONE COALESCE(( SELECT u.timezone
   FROM users u
  WHERE (u.id = completions.user_id)), 'UTC'::text)))::date - 1)) AND (NOT (EXISTS ( SELECT 1
   FROM completions c2
  WHERE ((c2.circle_id = completions.circle_id) AND (c2.user_id = completions.user_id) AND (c2.local_date = completions.local_date)))))));

alter policy "a user can delete their own completion" on public.completions
  using ((user_id = (select auth.uid())));

alter policy "a user can log their own completion" on public.completions
  with check (((user_id = (select auth.uid())) AND (kind = 'self'::text) AND is_member_of_circle(circle_id)));

-- ── device_tokens ────────────────────────────────────────────────────
alter policy "a user can read their own device tokens" on public.device_tokens
  using ((user_id = (select auth.uid())));

alter policy "a user can register their own device token" on public.device_tokens
  with check ((user_id = (select auth.uid())));

alter policy "a user can remove their own device token" on public.device_tokens
  using ((user_id = (select auth.uid())));

alter policy "a user can update their own device token" on public.device_tokens
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

-- ── journal_facts ────────────────────────────────────────────────────
alter policy "a user can read their own journal facts" on public.journal_facts
  using ((user_id = (select auth.uid())));

-- ── memberships ──────────────────────────────────────────────────────
alter policy "a user can add their own membership row" on public.memberships
  with check ((user_id = (select auth.uid())));

-- ── notification_prefs ───────────────────────────────────────────────
alter policy "a user can read their own notification prefs" on public.notification_prefs
  using ((user_id = (select auth.uid())));

alter policy "a user can update their own notification prefs" on public.notification_prefs
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

-- ── observation_responses ────────────────────────────────────────────
alter policy "a user can read their own observation responses" on public.observation_responses
  using ((user_id = (select auth.uid())));

alter policy "a user can save their own observation responses" on public.observation_responses
  with check ((user_id = (select auth.uid())));

-- ── pebble_gifts ─────────────────────────────────────────────────────
alter policy "you can see pebbles you gave or were given" on public.pebble_gifts
  using (((from_user = (select auth.uid())) OR (to_user = (select auth.uid()))));

-- ── practices ────────────────────────────────────────────────────────
alter policy "creators can update their own practices" on public.practices
  using ((created_by = (select auth.uid())));

alter policy "practices visible per sharing rule" on public.practices
  using (((created_by IS NULL) OR (is_shared = true) OR (created_by = (select auth.uid())) OR practice_used_by_my_circle(id)));

alter policy "signed-in users can create their own practice" on public.practices
  with check ((created_by = (select auth.uid())));

-- ── question_dimension_rests ─────────────────────────────────────────
alter policy "a user can read their own dimension rests" on public.question_dimension_rests
  using ((user_id = (select auth.uid())));

alter policy "a user can update their own dimension rests" on public.question_dimension_rests
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy "a user can write their own dimension rests" on public.question_dimension_rests
  with check ((user_id = (select auth.uid())));

-- ── reflections ──────────────────────────────────────────────────────
alter policy "a user can insert only their own reflections" on public.reflections
  with check ((user_id = (select auth.uid())));

alter policy "a user can read only their own reflections" on public.reflections
  using ((user_id = (select auth.uid())));

alter policy "a user can update only their own reflections" on public.reflections
  using ((user_id = (select auth.uid())));

-- ── reports ──────────────────────────────────────────────────────────
alter policy "a user can read their own reports" on public.reports
  using ((reporter_id = (select auth.uid())));

alter policy "a user can report their own reports" on public.reports
  with check ((reporter_id = (select auth.uid())));

-- ── user_card_prefs ──────────────────────────────────────────────────
alter policy "a user can insert their own card prefs" on public.user_card_prefs
  with check ((user_id = (select auth.uid())));

alter policy "a user can read their own card prefs" on public.user_card_prefs
  using ((user_id = (select auth.uid())));

alter policy "a user can update their own card prefs" on public.user_card_prefs
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

-- ── users ────────────────────────────────────────────────────────────
alter policy "users can insert their own profile" on public.users
  with check ((id = (select auth.uid())));

alter policy "users can update their own profile" on public.users
  using ((id = (select auth.uid())));

alter policy "users readable by self and circle-mates" on public.users
  using (((id = (select auth.uid())) OR shares_circle_with(id)));

-- ── wall_message_reactions ───────────────────────────────────────────
alter policy "a user can change their own wall message reaction" on public.wall_message_reactions
  using ((from_user_id = (select auth.uid())));

alter policy "a user can remove their own wall message reaction" on public.wall_message_reactions
  using ((from_user_id = (select auth.uid())));

alter policy "circle members can react to wall messages" on public.wall_message_reactions
  with check (((from_user_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM wall_messages wm
  WHERE ((wm.id = wall_message_reactions.message_id) AND is_member_of_circle(wm.circle_id))))));

alter policy "circle members can read wall message reactions" on public.wall_message_reactions
  using (((EXISTS ( SELECT 1
   FROM wall_messages wm
  WHERE ((wm.id = wall_message_reactions.message_id) AND is_member_of_circle(wm.circle_id)))) AND (NOT (EXISTS ( SELECT 1
   FROM blocks b
  WHERE ((b.blocker_id = (select auth.uid())) AND (b.blocked_id = wall_message_reactions.from_user_id)))))));

-- ── wall_messages ────────────────────────────────────────────────────
alter policy "circle members can post wall messages" on public.wall_messages
  with check (((kind = 'post'::text) AND (recipient_id IS NULL) AND (user_id = (select auth.uid())) AND is_member_of_circle(circle_id) AND ((NOT ( SELECT circles.is_public
   FROM circles
  WHERE (circles.id = wall_messages.circle_id))) OR (( SELECT circles.created_by
   FROM circles
  WHERE (circles.id = wall_messages.circle_id)) = (select auth.uid())) OR COALESCE(( SELECT (memberships.join_source <> 'browse'::text)
   FROM memberships
  WHERE ((memberships.circle_id = wall_messages.circle_id) AND (memberships.user_id = (select auth.uid())))), false) OR (( SELECT count(*) AS count
   FROM completions c
  WHERE ((c.circle_id = wall_messages.circle_id) AND (c.user_id = (select auth.uid())))) >= 7))));

alter policy "circle members can read wall messages" on public.wall_messages
  using (((((kind = ANY (ARRAY['post'::text, 'celebration'::text, 'milestone'::text])) AND is_member_of_circle(circle_id)) OR ((kind = ANY (ARRAY['wave'::text, 'heart'::text])) AND (recipient_id = (select auth.uid())))) AND (NOT hidden) AND (NOT (EXISTS ( SELECT 1
   FROM reports r
  WHERE ((r.target_kind = 'wall_message'::text) AND (r.target_id = wall_messages.id) AND (r.reporter_id = (select auth.uid())))))) AND (NOT (EXISTS ( SELECT 1
   FROM blocks b
  WHERE ((b.blocker_id = (select auth.uid())) AND (b.blocked_id = wall_messages.user_id)))))));

alter policy "the circle creator or founder can delete wall messages" on public.wall_messages
  using (((EXISTS ( SELECT 1
   FROM circles c
  WHERE ((c.id = wall_messages.circle_id) AND (c.created_by = (select auth.uid()))))) OR is_founder()));

-- ── want_activations ─────────────────────────────────────────────────
alter policy "a user can create their own want activation" on public.want_activations
  with check ((user_id = (select auth.uid())));

alter policy "a user can read their own want activations" on public.want_activations
  using ((user_id = (select auth.uid())));
