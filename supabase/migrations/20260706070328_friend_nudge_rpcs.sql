-- Friend nudge (Notifications spec §4b): peer-to-peer, pre-written
-- messages only, server-enforced anti-pile-on (max one received nudge
-- per person per day across all circles/senders), always posts to the
-- wall. notification_outbox has zero client RLS policies (service-role
-- only — see notifications_foundations_schema), so this SECURITY
-- DEFINER RPC is the only way a client can enqueue one — it does its own
-- auth.uid()-driven checks rather than relying on RLS.
create or replace function public.send_friend_nudge(
  p_circle_id uuid,
  p_recipient_id uuid,
  p_local_date date,
  p_subject text,
  p_html text,
  p_wall_body text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dedupe_key text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if auth.uid() = p_recipient_id then
    raise exception 'cannot nudge yourself';
  end if;

  if not is_member_of_circle(p_circle_id) then
    raise exception 'not a member of this circle';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.circle_id = p_circle_id and m.user_id = p_recipient_id
  ) then
    raise exception 'recipient is not a member of this circle';
  end if;

  if exists (
    select 1 from public.completions c
    where c.user_id = p_recipient_id and c.local_date = p_local_date
  ) then
    raise exception 'already checked in';
  end if;

  if not coalesce((
    select friend_nudge_enabled from public.notification_prefs where user_id = p_recipient_id
  ), true) then
    raise exception 'nudges disabled';
  end if;

  v_dedupe_key := 'friend_nudge-' || p_recipient_id::text || '-' || p_local_date::text;

  if exists (select 1 from public.notification_outbox where dedupe_key = v_dedupe_key) then
    return 'already_nudged';
  end if;

  insert into public.notification_outbox (user_id, kind, payload, scheduled_for, dedupe_key)
  values (
    p_recipient_id,
    'friend_nudge',
    jsonb_build_object('subject', p_subject, 'html', p_html, 'local_date', p_local_date::text, 'waverId', auth.uid()),
    now(),
    v_dedupe_key
  );

  insert into public.wall_messages (circle_id, user_id, body)
  values (p_circle_id, auth.uid(), p_wall_body);

  return 'sent';
end;
$$;

revoke all on function public.send_friend_nudge(uuid, uuid, date, text, text, text) from public, anon;
grant execute on function public.send_friend_nudge(uuid, uuid, date, text, text, text) to authenticated;

-- Lets a sender know, without ever exposing another user's raw prefs row
-- (notification_prefs RLS only allows reading your own), whether a
-- specific circle-mate currently accepts friend nudges — "affordance
-- silently absent to senders" per spec, never "she muted you".
create or replace function public.is_friend_nudge_enabled(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select friend_nudge_enabled from public.notification_prefs where user_id = p_user_id),
    true
  );
$$;

revoke all on function public.is_friend_nudge_enabled(uuid) from public, anon;
grant execute on function public.is_friend_nudge_enabled(uuid) to authenticated;
