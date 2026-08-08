-- Cathy S joins the founder cap override — 8 August 2026, on Cat's instruction.
--
-- WHY. cathystewart2002@hotmail.com is now Cat's MAIN account — the native
-- iOS one she walks the app on — replacing catherine.f.harwood@gmail.com in
-- day-to-day use. She was sitting at exactly 3 active memberships, which IS
-- the product default cap, so she could not create another circle.
--
-- SCOPE. This is the same narrow personal allowlist the 6 July migration
-- established (app_caps_personal_override_for_founder) with a third id added.
-- The 3-circle default is UNCHANGED for every other account and remains the
-- product default for the friends cohort. max_members_per_circle stays 12.
--
-- TWO THINGS PRESERVED DELIBERATELY — do not drop either in a future edit:
--   * `set search_path to 'public'` — S1's pinning convention. The 6 July
--     precedent predates it; the LIVE function carries it, and rewriting
--     from that older file verbatim would silently unpin it.
--   * the HD4 S1 grant block below — app_caps() is a LIVE client RPC
--     (lib/caps.ts), and HD4's amendment records that it must carry a
--     DELIBERATE authenticated grant, because otherwise the first migration
--     to drop and recreate it takes the app away from every signed-in user.
--
-- NOTE FOR WHOEVER ADDS THE FOURTH. Three hardcoded uuids is roughly where
-- this stops being an override and starts wanting to be a column on `users`.
-- Deliberately NOT changed here: that is a product decision, not a tidy, and
-- this migration was asked for as a cap change rather than a redesign.

create or replace function public.app_caps()
returns table(max_circles_per_user int, max_members_per_circle int)
language sql
stable
set search_path to 'public'
as $$
  select
    case
      when auth.uid() in (
        '75ec0d88-27de-4227-ab62-3d049b369960', -- catherine.f.harwood@gmail.com
        '149bac2f-6557-403b-bf05-f830d42fc2e4', -- catherine.harwood@korefusion.com (test)
        'decc56b0-a748-448c-a469-2b0ac6957163'  -- cathystewart2002@hotmail.com (Cathy S — main from 8 Aug)
      ) then 10
      else 3
    end,
    12;
$$;

-- HD4's settled S1 block. `create or replace` preserves the existing ACL, so
-- this is belt-and-braces rather than strictly required today — but it states
-- intent in the catalog and is idempotent against the current grants.
revoke all on function public.app_caps() from public;
revoke all on function public.app_caps() from anon;
revoke all on function public.app_caps() from authenticated;
grant execute on function public.app_caps() to authenticated;
