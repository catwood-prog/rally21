-- HD2 job 1(c), 4 Aug — apply the practices policy S1 specified and never got.
--
-- Rally21-Security-Spec.md F5 named the hazard precisely: `practices.created_by`
-- becomes NULL for practices a departing account leaves behind (that is what
-- delete_account_prep does for practices surviving circles still reference),
-- "which the current practices SELECT policy treats as system practices,
-- visible to everyone". Its §4 fix was to stop reading `created_by is null`
-- as "system": "orphaned unshared practices become invisible rather than
-- leaking as 'system' practices."
--
-- The policy change was written into the spec and never applied. The
-- security-hardening suite has asserted it since 7 July and has been failing
-- for as long as anyone has actually run it, which until yesterday was never.
--
-- WHAT THIS DOES NOT DO, and why the spec's literal DDL is not used. S1 wrote
-- the replacement as `is_shared = true OR created_by = auth.uid()`. The live
-- policy has since grown a FOURTH disjunct that postdates the spec —
-- `practice_used_by_my_circle(id)`, which lets a member see the practice their
-- own circle runs on even when it is nobody's shared property. Applying S1's
-- text verbatim today would delete that clause and blind every member of a
-- private circle to their own practice name. So only the one disjunct S1
-- objected to is removed; the member-visibility clause stays, and it is
-- correctly scoped (it is true only for actual members of a circle using the
-- practice). ALTER POLICY rather than DROP/CREATE keeps the role list intact.

-- CLAUDE.md's own rule — "seed/system practices must set is_shared = true" —
-- had one violation live ("Breath of Fire & Fists of Anger"). Fix it BEFORE
-- narrowing the policy, or that practice would vanish for the circle using it
-- in the window between the two statements.
update public.practices
   set is_shared = true
 where created_by is null
   and is_shared = false;

alter policy "practices visible per sharing rule" on public.practices
  using (
    is_shared = true
    or created_by = (select auth.uid())
    or public.practice_used_by_my_circle(id)
  );
