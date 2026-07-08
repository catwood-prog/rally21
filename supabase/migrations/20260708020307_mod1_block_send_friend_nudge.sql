-- MOD1: waves stop BOTH directions once blocked — a designed quiet
-- outcome ('blocked'), not an error, same non-exceptional shape as
-- already_nudged/wave_cap_reached (W1's own convention).
create or replace function public.send_friend_nudge(p_circle_id uuid, p_recipient_id uuid, p_local_date date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dedupe_key text;
  v_sender_name text;
  v_recipient_name text;
  v_sender_tz text;
  v_sender_local_today date;
  v_sender_sends_today int;
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
    select 1 from public.blocks
    where (blocker_id = auth.uid() and blocked_id = p_recipient_id)
       or (blocker_id = p_recipient_id and blocked_id = auth.uid())
  ) then
    return 'blocked';
  end if;

  if not coalesce((
    select friend_nudge_enabled from public.notification_prefs
    where user_id = p_recipient_id
  ), true) then raise exception 'nudges disabled'; end if;

  v_dedupe_key := 'friend_nudge-' || p_recipient_id::text || '-' || p_local_date::text;
  if exists (select 1 from public.notification_outbox where dedupe_key = v_dedupe_key) then
    return 'already_nudged';
  end if;

  -- Quiet per-sender daily cap — the real abuse guard now that a wave
  -- can never fail for social reasons. Counted against the SENDER's own
  -- local calendar day (their timezone), not the recipient's.
  select coalesce(timezone, 'UTC') into v_sender_tz from public.users where id = auth.uid();
  if v_sender_tz is null then v_sender_tz := 'UTC'; end if;
  v_sender_local_today := (now() at time zone v_sender_tz)::date;

  select count(*) into v_sender_sends_today
  from public.notification_outbox
  where kind = 'friend_nudge'
    and payload->>'waverId' = auth.uid()::text
    and (created_at at time zone v_sender_tz)::date = v_sender_local_today;

  if v_sender_sends_today >= 10 then
    return 'wave_cap_reached';
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
    v_sender_name || ' waved at ' || v_recipient_name || ' 👋');

  return 'sent';
end;
$$;
