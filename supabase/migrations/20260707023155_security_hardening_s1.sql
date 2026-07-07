-- Security hardening: function grants, search paths, users/practices
-- policies, server-composed friend nudge, account deletion prep.
-- Spec: ../Rally21-Security-Spec.md

-- 1 · Function grants -----------------------------------------------------
revoke execute on function public.create_circle(text, time without time zone, text, boolean) from anon;
revoke execute on function public.join_public_circle(uuid) from anon;
revoke execute on function public.list_public_circles(uuid) from anon;
revoke execute on function public.count_open_circles_by_practice() from anon;
revoke execute on function public.leave_circle(uuid) from anon, public;
revoke execute on function public.app_caps() from anon, public;

-- trigger functions run as table owner; client roles never need EXECUTE
revoke execute on function public.set_practice_key() from anon, authenticated, public;
revoke execute on function public.set_updated_at() from anon, authenticated, public;

-- future functions created by migrations get NO default public EXECUTE;
-- every new function must grant explicitly (CLAUDE.md rule below)
alter default privileges in schema public revoke execute on functions from public;

-- 2 · Pin search paths ----------------------------------------------------
alter function public.app_caps() set search_path = public;
alter function public.set_practice_key() set search_path = public;

-- 3 · Scope the users read policy ------------------------------------------
create or replace function public.shares_circle_with(p_other_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.circle_id = mine.circle_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_other_user_id
  );
$$;
revoke execute on function public.shares_circle_with(uuid) from anon, public;
grant execute on function public.shares_circle_with(uuid) to authenticated, service_role;

drop policy "users are readable by any signed-in member" on public.users;
create policy "users readable by self and circle-mates"
  on public.users for select to authenticated
  using (id = auth.uid() or public.shares_circle_with(id));

-- 4 · Practices: created_by IS NULL no longer means "visible to all" ------
drop policy "practices visible per sharing rule" on public.practices;
create policy "practices visible per sharing rule"
  on public.practices for select to authenticated
  using (is_shared = true or created_by = auth.uid());

-- 5 · send_friend_nudge: server-side composition ---------------------------
drop function public.send_friend_nudge(uuid, uuid, date, text, text, text);

create function public.send_friend_nudge(
  p_circle_id uuid,
  p_recipient_id uuid,
  p_local_date date
) returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_dedupe_key text;
  v_sender_name text;
  v_recipient_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if auth.uid() = p_recipient_id then raise exception 'cannot nudge yourself'; end if;
  if not is_member_of_circle(p_circle_id) then
    raise exception 'not a member of this circle';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.circle_id = p_circle_id and m.user_id = p_recipient_id
  ) then raise exception 'recipient is not a member of this circle'; end if;
  if exists (
    select 1 from public.completions c
    where c.user_id = p_recipient_id and c.local_date = p_local_date
  ) then raise exception 'already checked in'; end if;
  if not coalesce((
    select friend_nudge_enabled from public.notification_prefs
    where user_id = p_recipient_id
  ), true) then raise exception 'nudges disabled'; end if;

  v_dedupe_key := 'friend_nudge-' || p_recipient_id::text || '-' || p_local_date::text;
  if exists (select 1 from public.notification_outbox where dedupe_key = v_dedupe_key) then
    return 'already_nudged';
  end if;

  select coalesce(name, 'a circle-mate') into v_sender_name
  from public.users where id = auth.uid();

  select coalesce(name, 'a circle-mate') into v_recipient_name
  from public.users where id = p_recipient_id;

  insert into public.notification_outbox (user_id, kind, payload, scheduled_for, dedupe_key)
  values (
    p_recipient_id, 'friend_nudge',
    jsonb_build_object(
      'local_date', p_local_date::text,
      'waverId', auth.uid(),
      'senderName', v_sender_name,
      'circleName', (select name from public.circles where id = p_circle_id)
    ),
    now(), v_dedupe_key
  );

  insert into public.wall_messages (circle_id, user_id, body)
  values (p_circle_id, auth.uid(),
    -- Matches constants/strings.ts's wallWaveEntry(waverName, targetName)
    -- verbatim — the copy moves server-side, it does not change.
    v_sender_name || ' waved at ' || v_recipient_name || ' 👋');

  return 'sent';
end;
$$;
revoke execute on function public.send_friend_nudge(uuid, uuid, date) from anon, public;
grant execute on function public.send_friend_nudge(uuid, uuid, date) to authenticated, service_role;

-- 6 · Account deletion prep ------------------------------------------------
create function public.delete_account_prep(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  -- (a) hosted circles with other members: transfer host to earliest member
  update public.circles c
  set created_by = (
    select m.user_id from public.memberships m
    where m.circle_id = c.id and m.user_id <> p_user_id
    order by m.joined_at asc, m.user_id asc
    limit 1
  )
  where c.created_by = p_user_id
    and exists (select 1 from public.memberships m
                where m.circle_id = c.id and m.user_id <> p_user_id);

  -- (b) hosted circles with no other members: delete outright
  delete from public.circles c
  where c.created_by = p_user_id
    and not exists (select 1 from public.memberships m
                    where m.circle_id = c.id and m.user_id <> p_user_id);

  -- (c) last member but not creator: deactivate, mirroring leave_circle
  update public.circles c
  set is_active = false
  where c.created_by is distinct from p_user_id
    and exists (select 1 from public.memberships m
                where m.circle_id = c.id and m.user_id = p_user_id)
    and not exists (select 1 from public.memberships m
                    where m.circle_id = c.id and m.user_id <> p_user_id);

  -- (d) practices: delete unreferenced customs, orphan the rest
  delete from public.practices p
  where p.created_by = p_user_id
    and not exists (select 1 from public.circles c where c.practice_id = p.id);

  update public.practices set created_by = null where created_by = p_user_id;
end;
$$;
revoke execute on function public.delete_account_prep(uuid) from anon, authenticated, public;
grant execute on function public.delete_account_prep(uuid) to service_role;
