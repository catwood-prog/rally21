
-- Powers the "N open circles" line on Find-a-practice — security definer
-- because memberships rows are otherwise only visible to a circle's own
-- members, which would make every count look like 0 for circles the
-- caller hasn't joined (see list_public_circles for the same reasoning).
create or replace function public.count_open_circles_by_practice()
returns table (practice_id uuid, open_circles bigint)
language sql
security definer
set search_path = public
as $$
  select c.practice_id, count(*) as open_circles
  from public.circles c
  where c.is_public = true
    and (select count(*) from public.memberships m where m.circle_id = c.id) < 12
  group by c.practice_id;
$$;

revoke all on function public.count_open_circles_by_practice() from public;
grant execute on function public.count_open_circles_by_practice() to authenticated;
