-- RETURNS TABLE(user_id uuid, local_date date) implicitly creates
-- PL/pgSQL variables named user_id/local_date, which collided with the
-- memberships.user_id column reference in the membership check below.
-- Never caught before because this function had never actually been
-- exercised against real membership data until now.
create or replace function public.get_checkin_presence(p_circle_id uuid)
returns table (user_id uuid, local_date date)
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.memberships m
    where m.circle_id = p_circle_id and m.user_id = auth.uid()
  ) then
    raise exception 'Not a member of this circle';
  end if;

  return query
    select c.user_id, c.local_date
    from public.checkins c
    where c.circle_id = p_circle_id;
end;
$$;
