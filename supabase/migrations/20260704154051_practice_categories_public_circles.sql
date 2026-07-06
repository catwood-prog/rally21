
-- 1. practices: category, duration, custom-practice ownership, archiving
alter table public.practices
  add column category text,
  add column duration_minutes integer,
  add column created_by uuid references public.users(id),
  add column is_archived boolean not null default false;

update public.practices set category = 'mind' where category is null;

update public.practices set duration_minutes = case key
  when 'meditation-5' then 5
  when 'meditation-10' then 10
  when 'meditation-15' then 15
  else duration_minutes
end
where duration_minutes is null;

alter table public.practices
  alter column category set not null,
  add constraint practices_category_check check (category in ('move', 'mind', 'make', 'learn'));

-- custom (user-created) practices don't come with a human-chosen key —
-- derive a unique one from the row's own id instead of requiring the client
-- to invent one.
create or replace function public.set_practice_key()
returns trigger
language plpgsql
as $$
begin
  if new.key is null then
    new.key := new.id::text;
  end if;
  return new;
end;
$$;

create trigger practices_set_key
before insert on public.practices
for each row execute function public.set_practice_key();

create policy "signed-in users can create their own practice"
  on public.practices for insert
  with check (created_by = auth.uid());

create policy "creators can update their own practices"
  on public.practices for update
  using (created_by = auth.uid());

-- 2. circles: public/private visibility
alter table public.circles add column is_public boolean not null default false;

drop policy "members can read their own circles" on public.circles;
create policy "members can read their own circles or public ones"
  on public.circles for select
  using (is_member_of_circle(id) or is_public);

-- 3. create_circle: accept visibility choice
drop function public.create_circle(text, time, text);

create function public.create_circle(
  p_practice_key text,
  p_time_of_day time,
  p_circle_name text,
  p_is_public boolean default false
)
returns table (circle_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_practice_id uuid;
  v_circle_id uuid;
  v_code text;
  v_chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_attempt int := 0;
  v_name text := nullif(trim(p_circle_name), '');
begin
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
$$;

revoke all on function public.create_circle(text, time, text, boolean) from public;
grant execute on function public.create_circle(text, time, text, boolean) to authenticated;

-- 4. member cap (12) — applies to code-joins and public-browse joins alike
create or replace function public.join_circle_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_circle_id uuid;
  v_count int;
begin
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
begin
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

  return p_circle_id;
end;
$$;

revoke all on function public.join_public_circle(uuid) from public;
grant execute on function public.join_public_circle(uuid) to authenticated;

-- 5. browse public circles — security definer so member counts are
-- computed correctly (memberships rows are otherwise only visible to a
-- circle's own members, which would make every count look like 0)
create or replace function public.list_public_circles()
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
    and not exists (
      select 1 from public.memberships m2
      where m2.circle_id = c.id and m2.user_id = auth.uid()
    )
  order by c.created_at desc;
$$;

revoke all on function public.list_public_circles() from public;
grant execute on function public.list_public_circles() to authenticated;
