-- PI1 (22 July) — practice instructions: a routine the host writes, the
-- circle reads, behind a quiet link. One nullable column, nothing more.
--
-- Source: PROMPTS.md PI1, pulled into the queue from the revised
-- practice-bank spec's product notes 7–8 (Cat's ruling). Media stays
-- URLs-only — the existing circles.resource_url remains the ONLY link;
-- this adds no upload surface of any kind.
--
-- WRITE PATH (deliberate): the host writes instructions with a plain
-- client UPDATE (lib/circle.ts setCircleInstructions), under the SAME
-- creator-only circles UPDATE policy (created_by = auth.uid()) that
-- already guards resource_url and duration_minutes — RLS is row-level and
-- column-agnostic, so no new policy is needed and a member/stranger write
-- fails closed exactly as it does for the link today. Instructions is
-- NOT threaded through the edit_circle RPC on purpose: adding a defaulted
-- p_instructions param would make every pre-PI1 cached client (which
-- omits it) silently CLEAR instructions on any name/time edit — the
-- classic new-optional-column-meets-old-client wipe. A dedicated helper
-- sidesteps that entirely and mirrors setCircleResourceUrl /
-- setCircleDurationMinutes, the established circle-field write pattern.

-- Nullable: a circle without a routine has no instructions row-state and
-- renders nothing (job 3: no empty-state stub). Cap ~2000 chars — long
-- enough for sets/reps or a breathing pattern, short enough to stay a
-- routine, not a blog (enforced here as a backstop to the client
-- maxLength, same posture as circles_resource_url_http_check).
alter table public.circles add column instructions text;

alter table public.circles add constraint circles_instructions_length_check
  check (instructions is null or char_length(instructions) <= 2000);

-- Cheap, safe apply-time guard that the column + constraint actually
-- landed (the full "host writes, member reads, stranger neither" RLS
-- proof and the CHECK-enforcement proof run rolled-back against the live
-- DB in verification, and permanently in supabase/edit-circle.integration
-- .test.ts — this migration stays free of fixture inserts / role
-- switching so an apply can never half-land).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'circles' and column_name = 'instructions'
  ) then
    raise exception 'PI1: circles.instructions column did not land';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'circles_instructions_length_check'
  ) then
    raise exception 'PI1: circles_instructions_length_check constraint did not land';
  end if;
end $$;
