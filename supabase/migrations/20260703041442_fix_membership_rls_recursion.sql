-- Both the memberships SELECT policy (querying memberships from within its
-- own policy) and the circles SELECT policy (querying memberships, which
-- re-triggers memberships' own broken policy) recursed infinitely. Standard
-- fix: a SECURITY DEFINER helper that checks membership without RLS
-- re-applying to its own internal query.
create function public.is_member_of_circle(p_circle_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.memberships
    where circle_id = p_circle_id and user_id = auth.uid()
  );
$$;

revoke execute on function public.is_member_of_circle(uuid) from public, anon;
grant execute on function public.is_member_of_circle(uuid) to authenticated;

drop policy "members can see who else is in their circles" on public.memberships;
create policy "members can see who else is in their circles"
  on public.memberships for select
  to authenticated
  using (public.is_member_of_circle(circle_id));

drop policy "members can read their own circles" on public.circles;
create policy "members can read their own circles"
  on public.circles for select
  to authenticated
  using (public.is_member_of_circle(id));
