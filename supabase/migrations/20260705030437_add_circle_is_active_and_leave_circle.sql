-- Leaving a circle keeps the member's completions/reflections (history
-- belongs to the member) but removes their membership. A circle that
-- drops to zero members is marked inactive rather than deleted, so its
-- history and invite code stay intact for anyone who wants to come back.
alter table public.circles add column is_active boolean not null default true;

create or replace function public.leave_circle(p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
begin
  delete from public.memberships where circle_id = p_circle_id and user_id = auth.uid();

  select count(*) into v_remaining from public.memberships where circle_id = p_circle_id;
  if v_remaining = 0 then
    update public.circles set is_active = false where id = p_circle_id;
  end if;
end;
$$;

grant execute on function public.leave_circle(uuid) to authenticated;

-- Joining (by code or as a public circle) is how you "come back" per the
-- leave-circle copy — reactivate a circle that went inactive when its
-- last member left.
create or replace function public.join_circle_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_circle_id uuid;
  v_count int;
  v_my_circle_count int;
begin
  select count(*) into v_my_circle_count from public.memberships where user_id = auth.uid();
  if v_my_circle_count >= 3 then
    raise exception 'You''re in 3 circles already — finish one or leave one to add another.';
  end if;

  select id into target_circle_id from public.circles where invite_code = upper(code);

  if target_circle_id is null then
    raise exception 'No circle found for that code';
  end if;

  select count(*) into v_count from public.memberships where circle_id = target_circle_id;
  if v_count >= 12 then
    raise exception 'This circle is already full';
  end if;

  insert into public.memberships (circle_id, user_id, role)
  values (target_circle_id, auth.uid(), 'member')
  on conflict (circle_id, user_id) do nothing;

  update public.circles set is_active = true where id = target_circle_id;

  return target_circle_id;
end;
$$;

create or replace function public.join_public_circle(p_circle_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_public boolean;
  v_count int;
  v_my_circle_count int;
begin
  select count(*) into v_my_circle_count from public.memberships where user_id = auth.uid();
  if v_my_circle_count >= 3 then
    raise exception 'You''re in 3 circles already — finish one or leave one to add another.';
  end if;

  select is_public into v_is_public from public.circles where id = p_circle_id;

  if v_is_public is null or v_is_public = false then
    raise exception 'No circle found for that id';
  end if;

  select count(*) into v_count from public.memberships where circle_id = p_circle_id;
  if v_count >= 12 then
    raise exception 'This circle is already full';
  end if;

  insert into public.memberships (circle_id, user_id, role)
  values (p_circle_id, auth.uid(), 'member')
  on conflict (circle_id, user_id) do nothing;

  update public.circles set is_active = true where id = p_circle_id;

  return p_circle_id;
end;
$$;

-- Exclude zero-member ("ghost") circles from public discovery.
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
set search_path = public
as $$
  select c.practice_id, count(*) as open_circles
  from public.circles c
  where c.is_public = true
    and c.is_active = true
    and (select count(*) from public.memberships m where m.circle_id = c.id) < 12
  group by c.practice_id;
$$;
