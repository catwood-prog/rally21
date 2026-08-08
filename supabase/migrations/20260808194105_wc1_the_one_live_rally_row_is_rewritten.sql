-- WC1 job 3 (8 Aug 2026) — the backfill, and it is CAT'S RULING made at
-- run time on the actual list, not this session's judgement.
--
-- A wall row is frozen prose: 20260808130700 changed what
-- mark_celebration_seen COMPOSES, which moves every future milestone and
-- not one already written. So the live rows were counted, put in front of
-- her with their bodies before and after, and she ruled REWRITE —
-- the same ruling she made on AU1's four glow lines ("rewrite all 4").
--
-- THE WHOLE LIST, measured live on 8 Aug immediately before this
-- migration was written (not taken from a prompt):
--
--   kind='milestone' rows on any wall .......... 1
--   rows of ANY kind whose body says "rallied" . 1  (the same row)
--   journal_facts saying "rallied"/"practices" . 0
--
--   id      7aceadb0-add2-4712-a171-1155cf776e82
--   wall    Stretching/Yoga moves
--   written 2026-07-30 02:31:40 UTC
--   BEFORE  Russ has rallied 21 practices 🎉
--   AFTER   Russ has shown up for 21 days 🎉
--
-- WHY REWRITING IS HONEST HERE, and why it is a different act from PA4's
-- delete. PA4 DELETED two rows because they were FALSE — Cathy S had
-- eight practices and four, and the honest remedy for a sentence that was
-- never true is that it stops existing. This row was true when it was
-- written and is true now: Russ really did show up on 21 distinct days in
-- that circle, and this migration does not touch the NUMBER, the author,
-- the timestamp, the kind or the circle. Only the words the system chose
-- for its own sentence change, and nobody is being edited — Russ did not
-- write this line, the server did.
--
-- SCOPED BY ID **AND** BY THE EXACT OLD BODY, never a bare kind sweep or
-- a bare LIKE. Belt and braces on purpose: the id pins the one row Cat
-- actually saw and ruled on, and the body predicate means that if
-- anything about that row has changed since it was read minutes ago, this
-- statement updates NOTHING rather than overwriting a sentence nobody
-- reviewed. A milestone posted between the read and this migration
-- survives untouched either way.
--
-- The new body is rebuilt from the same pieces the function now composes
-- (name || ' has shown up for ' || n || ' days 🎉') rather than the name
-- being re-read from users — a rename since 30 July must not silently
-- rewrite the history of who was celebrated.
--
-- STAMP: 20260808194105, after this section's own 20260808132404 and
-- after another session's 20260808103052. Both WC1 files are named after
-- the versions supabase_migrations.schema_migrations actually holds --
-- apply_migration stamps its own timestamp, and a repo migration with no
-- registered version is re-applied by the next db push (the divergence
-- f2a4796 named as worth closing on sight). Touches one row of
-- wall_messages and no object either of them touches.

update public.wall_messages
set body = 'Russ has shown up for 21 days 🎉'
where id = '7aceadb0-add2-4712-a171-1155cf776e82'
  and kind = 'milestone'
  and body = 'Russ has rallied 21 practices 🎉';
