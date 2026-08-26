-- OB1 — one observation response per (person, pattern_type, direction),
-- and the last answer wins. BP1's guarantee, given to the one sibling
-- BP1's own job-5 sweep found.
--
-- WHAT WAS WRONG. `observation_responses` has carried ZERO unique
-- constraints since D6 created it on 4 July, and lib/reflections.ts wrote
-- to it with a plain `.insert()` — the exact shape that let
-- `blueprint_responses` take seven identical confirmations of one pattern
-- in eleven seconds on 16 Aug. The only thing standing between this table
-- and the same history is reflection.tsx's `response === null ?` render
-- guard, which is precisely the guard the private map did not have. That
-- guard stays; it is no longer the only thing holding the line.
--
-- NOTHING TO COLLAPSE, MEASURED NOT ASSUMED. Before this migration the
-- table held 1 row, 1 distinct user, and 0 duplicate groups under either
-- candidate key. So there is deliberately NO delete statement here: BP1
-- needed one because BP1 had nine rows to fold into three, and a delete
-- that has no work to do is still a delete running against a live table.
--
-- WHY THE KEY IS THE TRIPLE. The reader decides, not the writer.
-- `getMyObservationResponse` filters on user_id, pattern_type AND
-- direction, so it treats "before noon is your better half" and "after
-- noon is" as two separate claims to have answered — which they are. A
-- unique (user_id, pattern_type) would forbid a legitimate state: a
-- person whose time-of-day pattern flips has genuinely answered two
-- different sentences about themselves, and the reader would still go
-- looking for the second one.
--
-- STAMP: 20260826224312 is the version supabase_migrations.schema_migrations
-- actually holds — apply_migration mints its OWN timestamp, and a repo
-- migration with no registered version gets re-applied by the next db push
-- (BP1's find, d732fd0). That matters here because neither statement below
-- is idempotent: `add constraint` and `create policy` both fail on a second
-- run.

-- ── 1. the constraint that makes a second answer impossible ──────────
alter table public.observation_responses
  add constraint observation_responses_user_id_pattern_type_direction_key
  unique (user_id, pattern_type, direction);

-- ── 2. changing your mind is allowed, so the write needs UPDATE ──────
-- The table has only ever had SELECT and INSERT policies (read back from
-- pg_policy, not from the migration file), which is why an upsert could
-- not have worked before today: `insert ... on conflict do update` needs
-- an UPDATE policy as well as the INSERT one, and without it a second tap
-- would fail RLS instead of merging. Owner-scoped like its two siblings,
-- in RLS1's `(select auth.uid())` initplan form.
create policy "a user can change their own observation response"
  on public.observation_responses for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
