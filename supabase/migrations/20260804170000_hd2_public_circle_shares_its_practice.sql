-- HD2 job 1(b), 4 Aug — a public circle's practice is shared, by construction.
--
-- THE INVARIANT (CLAUDE.md's practice-privacy convention): a custom practice
-- starts private and becomes shared the moment a public circle uses it,
-- one-directionally. `create_circle` has implemented that since 6 July.
-- Three live circles nonetheless had a public circle over an is_shared=false
-- practice, which leaked those practice ids (and their open-circle counts) to
-- every signed-in user through count_open_circles_by_practice() — a SECURITY
-- DEFINER function that bypasses RLS by design.
--
-- TWO causes, found by the integration suite's first real run:
--
--  1. HISTORIC, already closed. 20260707023155_security_hardening_s1.sql
--     redefined create_circle with `create or replace` and silently DROPPED
--     the `update practices set is_shared = true` line. OC1 (674f847,
--     13 July) restored it. Any public circle created in that six-day window
--     kept a private practice — "Read before bed", 10 July, is one.
--
--  2. LIVE, and the reason this migration exists. The circles UPDATE policy
--     is `created_by = auth.uid()` with no WITH CHECK and no column list, so
--     a host can flip is_public with a plain PostgREST PATCH and never go
--     through create_circle at all. Proven in a rolled-back transaction on
--     4 Aug: circle public, practice still private, and an unrelated user's
--     counter call returned its id.
--
-- So the rule moves out of one RPC and onto the table, where every route has
-- to obey it. create_circle's own update becomes redundant but is left alone
-- — it is correct, and removing it is not this section's job.

-- Backfill first, so the invariant is true before it is enforced.
update public.practices p
   set is_shared = true
  from public.circles c
 where c.practice_id = p.id
   and c.is_public
   and p.is_shared = false;

create or replace function public.share_practice_of_public_circle()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- SECURITY DEFINER because the host flipping their circle public does not
  -- necessarily own the practice row (a seeded or cloned one), and the
  -- practices UPDATE policy would refuse them.
  update public.practices
     set is_shared = true
   where id = new.practice_id
     and is_shared = false;
  return null;
end;
$$;

-- S1's convention: revoke explicitly, never rely on the project default,
-- which still grants EXECUTE to anon on every new function.
revoke all on function public.share_practice_of_public_circle() from public;
revoke all on function public.share_practice_of_public_circle() from anon;
grant execute on function public.share_practice_of_public_circle() to service_role;

drop trigger if exists circles_public_shares_practice on public.circles;
create trigger circles_public_shares_practice
  after insert or update of is_public, practice_id on public.circles
  for each row
  when (new.is_public)
  execute function public.share_practice_of_public_circle();
