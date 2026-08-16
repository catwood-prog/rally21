-- BP1 — one blueprint response per person per pattern, and the last
-- answer wins.
--
-- WHAT WAS WRONG. `blueprint_responses` has carried ZERO unique
-- constraints since B1 created it on 7 July, and lib/blueprint.ts wrote to
-- it with a plain `.insert()`. The private map's answered card never
-- resolved either (`activePattern` was chosen by key alone and never
-- consulted the responses, so an answered pattern rendered as the active
-- card WITH LIVE BUTTONS and again below as "you said this sounds right"
-- — fixed in the same change), so on 16 Aug the founder tapped "sounds
-- right" seven times in eleven seconds and every tap landed. The table
-- recorded seven identical confirmations of one pattern.
--
-- WHY THAT IS WORSE THAN A COUNT. This table is the record of what a
-- person said about themselves — it is read back by compose-blueprint as
-- the corrections that govern what may resurface. Seven copies of one
-- answer is a worse RECORD, not merely a worse number.
--
-- ORDER MATTERS: the collapse has to run BEFORE the constraint, or the
-- constraint cannot be created.
--
-- STAMP: 20260816193356 is the version supabase_migrations.schema_migrations
-- actually holds, not the 20260816193314 this file was first written under
-- — apply_migration stamps its OWN timestamp, and a repo migration with no
-- registered version gets re-applied by the next db push. That matters more
-- here than it did for WC1's two: this one is NOT idempotent (the add
-- constraint and the create policy both fail on a second run), so the file
-- is named after the registry, per cf09cac.

-- ── 1. collapse the duplicates that already exist ────────────────────
-- Keeps, for each (user_id, pattern_key), the row with the EARLIEST
-- created_at — that is when the person actually answered; every later row
-- is the interface failing to tell them it had landed. `id` breaks a
-- created_at tie so the surviving row is deterministic rather than
-- whichever one the planner reached first.
delete from public.blueprint_responses r
where exists (
  select 1
  from public.blueprint_responses keep
  where keep.user_id = r.user_id
    and keep.pattern_key = r.pattern_key
    and (keep.created_at, keep.id) < (r.created_at, r.id)
);

-- ── 2. the constraint that makes it impossible to happen again ───────
-- The constraint, not the client, is the guarantee. A read-then-write in
-- app code would lose exactly the race this bug is made of: two taps in
-- flight at once, neither seeing the other's row.
alter table public.blueprint_responses
  add constraint blueprint_responses_user_id_pattern_key_key
  unique (user_id, pattern_key);

-- ── 3. changing your mind is allowed, so the write needs UPDATE ──────
-- This table has only ever had SELECT and INSERT policies, which is why an
-- upsert could not have worked before today: `insert ... on conflict do
-- update` needs an UPDATE policy as well as the INSERT one, and without it
-- the second tap would fail RLS instead of merging. A person is allowed to
-- move from `confirmed` to `not_quite` and back, so the last answer wins.
-- Same owner-scoping as the other two policies, in RLS1's
-- `(select auth.uid())` initplan form.
create policy "a user can change their own blueprint response"
  on public.blueprint_responses for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
