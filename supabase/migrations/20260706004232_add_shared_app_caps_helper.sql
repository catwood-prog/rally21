create or replace function public.app_caps()
returns table(max_circles_per_user int, max_members_per_circle int)
language sql
immutable
as $$
  select 3, 12;
$$;

create or replace function public.create_circle(p_practice_key text, p_time_of_day time without time zone, p_circle_name text, p_is_public boolean default false)
returns table(circle_id uuid, invite_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_practice_id uuid;
  v_circle_id uuid;
  v_code text;
  v_chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_attempt int := 0;
  v_name text := nullif(trim(p_circle_name), '');
  v_my_circle_count int;
  v_max_circles int;
begin
  select max_circles_per_user into v_max_circles from public.app_caps();

  select count(*) into v_my_circle_count from public.memberships where user_id = auth.uid();
  if v_my_circle_count >= v_max_circles then
    raise exception 'You''re in % circles already — finish one or leave one to add another.', v_max_circles;
  end if;

  select id into v_practice_id from public.practices where key = p_practice_key;
  if v_practice_id is null then
    raise exception 'Unknown practice: %', p_practice_key;
  end if;

  if v_name is null then
    select name into v_name from public.practices where id = v_practice_id;
  end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    end loop;

    begin
      insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public)
      values (v_name, v_practice_id, v_code, p_time_of_day, auth.uid(), coalesce(p_is_public, false))
      returning id into v_circle_id;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 5 then
        raise exception 'Could not generate a unique invite code — try again';
      end if;
    end;
  end loop;

  insert into public.memberships (circle_id, user_id, role)
  values (v_circle_id, auth.uid(), 'owner');

  return query select v_circle_id, v_code;
end;
$function$;

create or replace function public.join_circle_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target_circle_id uuid;
  v_count int;
  v_my_circle_count int;
  v_max_circles int;
  v_max_members int;
begin
  select max_circles_per_user, max_members_per_circle into v_max_circles, v_max_members from public.app_caps();

  select count(*) into v_my_circle_count from public.memberships where user_id = auth.uid();
  if v_my_circle_count >= v_max_circles then
    raise exception 'You''re in % circles already — finish one or leave one to add another.', v_max_circles;
  end if;

  select id into target_circle_id from public.circles where invite_code = upper(code);

  if target_circle_id is null then
    raise exception 'No circle found for that code';
  end if;

  select count(*) into v_count from public.memberships where circle_id = target_circle_id;
  if v_count >= v_max_members then
    raise exception 'This circle is already full';
  end if;

  insert into public.memberships (circle_id, user_id, role)
  values (target_circle_id, auth.uid(), 'member')
  on conflict (circle_id, user_id) do nothing;

  update public.circles set is_active = true where id = target_circle_id;

  return target_circle_id;
end;
$function$;

create or replace function public.join_public_circle(p_circle_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_public boolean;
  v_count int;
  v_my_circle_count int;
  v_max_circles int;
  v_max_members int;
begin
  select max_circles_per_user, max_members_per_circle into v_max_circles, v_max_members from public.app_caps();

  select count(*) into v_my_circle_count from public.memberships where user_id = auth.uid();
  if v_my_circle_count >= v_max_circles then
    raise exception 'You''re in % circles already — finish one or leave one to add another.', v_max_circles;
  end if;

  select is_public into v_is_public from public.circles where id = p_circle_id;

  if v_is_public is null or v_is_public = false then
    raise exception 'No circle found for that id';
  end if;

  select count(*) into v_count from public.memberships where circle_id = p_circle_id;
  if v_count >= v_max_members then
    raise exception 'This circle is already full';
  end if;

  insert into public.memberships (circle_id, user_id, role)
  values (p_circle_id, auth.uid(), 'member')
  on conflict (circle_id, user_id) do nothing;

  update public.circles set is_active = true where id = p_circle_id;

  return p_circle_id;
end;
$function$;

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
    and (select count(*) from public.memberships m where m.circle_id = c.id) < (select max_members_per_circle from public.app_caps())
  group by c.practice_id;
$function$;
