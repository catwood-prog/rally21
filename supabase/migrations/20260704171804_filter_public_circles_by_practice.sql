
drop function public.list_public_circles();

create function public.list_public_circles(p_practice_id uuid default null)
returns table (
  circle_id uuid,
  name text,
  practice_name text,
  member_count bigint,
  day_number int,
  duration_days int
)
language sql
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    p.name,
    (select count(*) from public.memberships m where m.circle_id = c.id),
    greatest(1, (current_date - c.start_date) + 1),
    c.duration_days
  from public.circles c
  join public.practices p on p.id = c.practice_id
  where c.is_public = true
    and (p_practice_id is null or c.practice_id = p_practice_id)
    and not exists (
      select 1 from public.memberships m2
      where m2.circle_id = c.id and m2.user_id = auth.uid()
    )
  order by c.created_at desc;
$$;

revoke all on function public.list_public_circles(uuid) from public;
grant execute on function public.list_public_circles(uuid) to authenticated;
