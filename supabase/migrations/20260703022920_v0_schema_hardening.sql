-- Address advisor findings from the initial migration.

-- 1. checkin_presence was a bare security-definer view (flagged ERROR by
--    the linter — it silently bypasses RLS for anyone who can query it).
--    Replace with a SECURITY DEFINER function instead: same bypass, but
--    explicit, revocable per-role, and not flagged as an implicit view leak.
drop view if exists public.checkin_presence;

create function public.get_checkin_presence(p_circle_id uuid)
returns table (user_id uuid, local_date date)
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.memberships
    where circle_id = p_circle_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this circle';
  end if;

  return query
    select c.user_id, c.local_date
    from public.checkins c
    where c.circle_id = p_circle_id;
end;
$$;

revoke execute on function public.get_checkin_presence(uuid) from public;
grant execute on function public.get_checkin_presence(uuid) to authenticated;

-- 2. lock down search_path on the updated_at trigger function too
alter function public.set_updated_at() set search_path = public;

-- 3. handle_new_user is trigger-only — it should never be callable
--    directly over the API by anon or authenticated.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 4. join_circle_by_code must be signed-in only, not anon.
revoke execute on function public.join_circle_by_code(text) from anon;
