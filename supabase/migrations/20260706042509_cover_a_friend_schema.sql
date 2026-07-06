alter table public.completions
  add column kind text not null default 'self',
  add column covered_by uuid null references public.users(id) on delete set null;

alter table public.completions
  add constraint completions_kind_check check (kind in ('self', 'covered'));

alter table public.completions
  add constraint completions_covered_by_matches_kind check (
    (kind = 'covered' and covered_by is not null)
    or (kind = 'self' and covered_by is null)
  );

-- The existing self-insert policy still applies unchanged (user_id =
-- auth.uid()), now additionally scoped to kind='self' for clarity/
-- defense-in-depth alongside the check constraint above.
drop policy if exists "a user can log their own completion" on public.completions;
create policy "a user can log their own completion"
  on public.completions
  for insert
  with check (
    user_id = auth.uid()
    and kind = 'self'
    and is_member_of_circle(circle_id)
  );

-- Covering rules, enforced entirely in RLS (no SECURITY DEFINER RPC):
-- can't cover yourself, only a member of the circle can cover, the
-- covered person must also be a member, and the covered person must not
-- already have a completion today (this single check also enforces
-- "one cover per member per day" — a second cover attempt finds today's
-- row already exists and is rejected the same way).
create policy "a member can cover another member's day"
  on public.completions
  for insert
  with check (
    kind = 'covered'
    and covered_by = auth.uid()
    and user_id <> auth.uid()
    and is_member_of_circle(circle_id)
    and exists (
      select 1 from public.memberships m
      where m.circle_id = completions.circle_id and m.user_id = completions.user_id
    )
    and not exists (
      select 1 from public.completions c2
      where c2.circle_id = completions.circle_id
        and c2.user_id = completions.user_id
        and c2.local_date = completions.local_date
    )
  );
