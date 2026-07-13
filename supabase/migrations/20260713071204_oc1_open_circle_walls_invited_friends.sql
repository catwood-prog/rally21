-- OC1 (13 July) — the 7-completion earned-voice gate was designed for
-- strangers wandering in from browse, but scoped to ALL non-creator
-- members of a public circle, catching invited friends too. Cat's
-- decision: the gate now applies ONLY to browse joiners; invited
-- friends and creators post free text from day one, in public and
-- private circles alike.

alter table public.memberships
  add column join_source text not null default 'invite'
  check (join_source in ('creator', 'invite', 'browse'));

-- Backfill: the creator's own membership row is 'creator'; every other
-- existing row becomes 'invite'. This cohort is a small, personally-
-- invited friends group — MOD1/O1 (strangers signing up) haven't
-- shipped yet, so there is no organic public-browse-discovery path any
-- real user could have taken yet. Confirmed live before writing this:
-- every non-creator membership belongs to a circle created by a known
-- cohort member (the founder or another friend), never a stranger
-- discovering an unrelated public circle — consistent with "invite",
-- not "browse".
update public.memberships m
set join_source = 'creator'
from public.circles c
where c.id = m.circle_id and c.created_by = m.user_id;

update public.memberships m
set join_source = 'invite'
from public.circles c
where c.id = m.circle_id and c.created_by <> m.user_id;

-- Set it at the source going forward.
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

  if coalesce(p_is_public, false) then
    update public.practices set is_shared = true where id = v_practice_id;
  end if;

  insert into public.memberships (circle_id, user_id, role, join_source)
  values (v_circle_id, auth.uid(), 'owner', 'creator');

  return query select v_circle_id, v_code;
end;
$function$;

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
  v_max_circles int;
  v_max_members int;
  v_closed boolean;
  v_already_member boolean;
begin
  select max_circles_per_user, max_members_per_circle into v_max_circles, v_max_members from public.app_caps();

  select count(*) into v_my_circle_count from public.memberships where user_id = auth.uid();
  if v_my_circle_count >= v_max_circles then
    raise exception 'You''re in % circles already — finish one or leave one to add another.', v_max_circles;
  end if;

  select id, closed_to_joins into target_circle_id, v_closed from public.circles where invite_code = upper(code);

  if target_circle_id is null then
    raise exception 'No circle found for that code';
  end if;

  select exists(select 1 from public.memberships where circle_id = target_circle_id and user_id = auth.uid())
    into v_already_member;

  if v_closed and not v_already_member then
    raise exception 'This circle isn''t taking new members right now';
  end if;

  select count(*) into v_count from public.memberships where circle_id = target_circle_id;
  if v_count >= v_max_members then
    raise exception 'This circle is already full';
  end if;

  insert into public.memberships (circle_id, user_id, role, join_source)
  values (target_circle_id, auth.uid(), 'member', 'invite')
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
  v_closed boolean;
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

  select is_public, closed_to_joins into v_is_public, v_closed from public.circles where id = p_circle_id;

  if v_is_public is null or v_is_public = false then
    raise exception 'No circle found for that id';
  end if;

  if v_closed then
    raise exception 'This circle isn''t taking new members right now';
  end if;

  select count(*) into v_count from public.memberships where circle_id = p_circle_id;
  if v_count >= v_max_members then
    raise exception 'This circle is already full';
  end if;

  insert into public.memberships (circle_id, user_id, role, join_source)
  values (p_circle_id, auth.uid(), 'member', 'browse')
  on conflict (circle_id, user_id) do nothing;

  update public.circles set is_active = true where id = p_circle_id;

  return p_circle_id;
end;
$$;

-- The gate now applies ONLY to browse joiners: private, OR creator, OR
-- join_source <> 'browse' (i.e. invited), OR 7+ completions in this
-- circle.
drop policy if exists "circle members can post wall messages" on public.wall_messages;

create policy "circle members can post wall messages"
  on public.wall_messages
  for insert
  with check (
    user_id = auth.uid()
    and is_member_of_circle(circle_id)
    and (
      not (select is_public from public.circles where id = wall_messages.circle_id)
      or (select created_by from public.circles where id = wall_messages.circle_id) = auth.uid()
      or coalesce((
        select join_source <> 'browse' from public.memberships
        where circle_id = wall_messages.circle_id and user_id = auth.uid()
      ), false)
      or (
        select count(*) from public.completions c
        where c.circle_id = wall_messages.circle_id and c.user_id = auth.uid()
      ) >= 7
    )
  );
