-- Open circles wall permissions + host controls (multi-circle spec,
-- "Open circles" section) — members of a PUBLIC circle can react
-- (curated emoji only) until they've earned free-text posting by
-- showing up (7 completions in that circle) or unless they're the
-- creator; private circles are unchanged (everyone posts freely from
-- day one). Enforced in RLS, not just the UI.

alter table public.circles
  add column closed_to_joins boolean not null default false;

alter table public.memberships
  add column has_seen_voice_unlocked_hint boolean not null default false;

-- Reactions on wall TEXT posts (not check-ins — that's checkin_reactions),
-- one per person per message, mirroring checkin_reactions' shape/rules.
create table public.wall_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.wall_messages(id) on delete cascade,
  from_user_id uuid not null references public.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, from_user_id)
);

alter table public.wall_message_reactions enable row level security;

create policy "circle members can read wall message reactions"
  on public.wall_message_reactions
  for select
  using (
    exists (
      select 1 from public.wall_messages wm
      where wm.id = wall_message_reactions.message_id
        and is_member_of_circle(wm.circle_id)
    )
  );

create policy "circle members can react to wall messages"
  on public.wall_message_reactions
  for insert
  with check (
    from_user_id = auth.uid()
    and exists (
      select 1 from public.wall_messages wm
      where wm.id = wall_message_reactions.message_id
        and is_member_of_circle(wm.circle_id)
    )
  );

create policy "a user can change their own wall message reaction"
  on public.wall_message_reactions
  for update
  using (from_user_id = auth.uid());

create policy "a user can remove their own wall message reaction"
  on public.wall_message_reactions
  for delete
  using (from_user_id = auth.uid());

-- Free-text wall posting is gated in public circles: the creator always
-- can; anyone else needs 7 completions in THIS circle first ("voice is
-- earned"). Private circles are untouched (the is_public check short-
-- circuits the OR).
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
      or (
        select count(*) from public.completions c
        where c.circle_id = wall_messages.circle_id and c.user_id = auth.uid()
      ) >= 7
    )
  );

-- Host content moderation: the creator can delete any wall post in a
-- circle they created.
create policy "the circle creator can delete wall messages"
  on public.wall_messages
  for delete
  using (
    exists (
      select 1 from public.circles c
      where c.id = wall_messages.circle_id and c.created_by = auth.uid()
    )
  );

-- Host control: remove a member (their completions/reflections are kept
-- — same effect as the member leaving themselves, just host-initiated).
create or replace function public.remove_member_from_circle(p_circle_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_remaining int;
begin
  select created_by into v_creator from public.circles where id = p_circle_id;
  if v_creator is null or v_creator <> auth.uid() then
    raise exception 'only the circle creator can remove a member';
  end if;
  if p_member_id = auth.uid() then
    raise exception 'use leave_circle to remove yourself';
  end if;

  delete from public.memberships where circle_id = p_circle_id and user_id = p_member_id;

  select count(*) into v_remaining from public.memberships where circle_id = p_circle_id;
  if v_remaining = 0 then
    update public.circles set is_active = false where id = p_circle_id;
  end if;
end;
$$;

revoke all on function public.remove_member_from_circle(uuid, uuid) from public, anon;
grant execute on function public.remove_member_from_circle(uuid, uuid) to authenticated;

-- Host control: close/reopen a circle to new joins (stops both browse
-- discovery and direct invite-code joins for anyone not already a
-- member). Reuses the existing "creator can update their circle" RLS
-- policy for the column write itself; these three RPCs enforce the read
-- side.
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

  insert into public.memberships (circle_id, user_id, role)
  values (p_circle_id, auth.uid(), 'member')
  on conflict (circle_id, user_id) do nothing;

  update public.circles set is_active = true where id = p_circle_id;

  return p_circle_id;
end;
$$;

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
    and c.closed_to_joins = false
    and (p_practice_id is null or c.practice_id = p_practice_id)
    and not exists (
      select 1 from public.memberships m2
      where m2.circle_id = c.id and m2.user_id = auth.uid()
    )
  order by c.created_at desc;
$$;
