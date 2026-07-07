-- R1 sweep: a completed circle (Rally21-Glow-Spec.md §8) is warmly
-- archived, read-only history — it should never surface in public-circle
-- discovery/join listings, same as an inactive circle already doesn't.

create or replace function public.list_public_circles(p_practice_id uuid default null)
returns table(circle_id uuid, name text, practice_name text, member_count bigint, day_number integer, duration_days integer)
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
    and c.is_active = true
    and c.completed_at is null
    and c.closed_to_joins = false
    and (p_practice_id is null or c.practice_id = p_practice_id)
    and not exists (
      select 1 from public.memberships m2
      where m2.circle_id = c.id and m2.user_id = auth.uid()
    )
  order by c.created_at desc;
$$;

create or replace function public.count_open_circles_by_practice()
returns table(practice_id uuid, open_circles bigint)
language sql
security definer
set search_path to 'public'
as $function$
  select c.practice_id, count(*) as open_circles
  from public.circles c
  where c.is_public = true
    and c.is_active = true
    and c.completed_at is null
    and (select count(*) from public.memberships m where m.circle_id = c.id) < (select max_members_per_circle from public.app_caps())
  group by c.practice_id;
$function$;
