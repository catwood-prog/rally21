-- ON2 (28 July, Cat's ruling 26 July) — the keep-going obstacle moves from
-- the MEMBERSHIP to the PERSON.
--
-- THE REFRAME: "you only reflect once a day regardless of number of
-- circles". The personal layer is once-daily and app-level, so the
-- obstacle is a fact about YOU ("I forget things"), not about one circle.
-- That dissolves the question that stalled ON1 job 2b — which circle's
-- answer should win a cross-circle welcome-back — because there is now
-- only one answer per person. It also puts Q2 exactly where Q1 already
-- lives (users.onboarding_desired_change), so the two halves of one
-- intake stop living in two places.
--
-- SAFE TO DROP, verified rather than assumed: the pre-drop count on this
-- database was 13 membership rows, 0 non-null keep_going_obstacle. The
-- reason it is zero is structural, not lucky — Q2 only ever fires for a
-- brand-new user and every existing account onboarded before ON1 shipped.
-- No backfill, therefore nothing to carry across.
--
-- OWN-ROW WRITE: the new column rides the existing own-row users UPDATE
-- policy ("users can update their own profile", id = auth.uid()) — the
-- same path Q1 has used since ON1, and the same path every other profile
-- field uses. That is why set_keep_going_obstacle goes away rather than
-- moving: memberships has no client UPDATE policy by design (S1/WL2), so
-- the obstacle needed a SECURITY DEFINER RPC there; users does, so on the
-- person it needs none, and a function that exists for no caller is one
-- more surface to keep revoked.
--
-- READ EXPOSURE, stated plainly and UNCHANGED by this move: the users
-- SELECT policy is `id = auth.uid() or shares_circle_with(id)` and the
-- memberships SELECT policy was `is_member_of_circle(circle_id)`, so a
-- circle-mate could read this value before and can read it after. Neither
-- table has column-level RLS. This is the same posture Q1 already has.
--
-- BRAND INTEGRITY (ON1's scope edge, carried): still SELF-REPORTED ("you
-- told us"), and still must never feed get_my_blueprint's observed-pattern
-- output or render in the private map's "we noticed" voice. Nothing in
-- this migration touches the blueprint.

alter table public.users
  add column keep_going_obstacle text
    check (
      keep_going_obstacle is null
      or keep_going_obstacle in ('forget', 'no_time', 'lose_motivation', 'miss_once', 'alone')
    );

comment on column public.users.keep_going_obstacle is
  'ON2 — the Day-0 intake''s Q2 ("what usually makes it hard to keep going?"), '
  'one answer per PERSON. Nullable (skipped, or pre-ON1). Self-reported: it '
  'biases which existing welcome-back line surfaces after a miss, and must '
  'never be read in the blueprint''s observed-pattern voice.';

-- The membership-scoped RPC has no caller left once the column below is
-- gone. Dropped in the same change rather than left revoked-and-dead.
drop function if exists public.set_keep_going_obstacle(uuid, text);

alter table public.memberships
  drop column keep_going_obstacle;
