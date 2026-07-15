-- HW1 (15 July, Cat's screenshot review): heart or wave — for every
-- circle-mate, always. The heart is a second, even lighter gesture than
-- the wave: pure warmth, no ask attached. It rides the wave's own path
-- (this same function, generalized with a gesture kind — never a fork),
-- so every existing guard comes for free: self-gesture rejection,
-- membership checks both ways, block enforcement in both directions
-- (MOD1's direction-neutral 'blocked'), the recipient opt-out, and the
-- quiet per-sender daily cap.
--
-- What differs by kind (Cat's rulings, 13 July):
-- - Per-recipient daily dedupe applies PER KIND: a wave and a heart to
--   the same friend the same day are both fine; a second of the SAME
--   kind returns the warm 'already_nudged' outcome.
-- - The 10/day sender cap is SHARED across kinds.
-- - A heart NEVER writes a notification_outbox row — no email, no
--   future push. It lands as a synchronous wall line only. The wave's
--   outbox/email behavior is byte-for-byte unchanged.
--
-- The wave's outbox row doubles as its own dedupe/cap record; the heart
-- is forbidden that row, so it gets the minimal ledger below —
-- bookkeeping for the shared guards, not a second delivery pipeline.

create table public.friend_hearts (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  sender_id uuid not null references public.users (id) on delete cascade,
  recipient_id uuid not null references public.users (id) on delete cascade,
  local_date date not null,
  created_at timestamptz not null default now()
);

-- The pile-on guard at the table itself: one received heart per person
-- per day, mirroring the wave's outbox dedupe_key uniqueness.
create unique index friend_hearts_one_per_recipient_per_day
  on public.friend_hearts (recipient_id, local_date);

-- The shared sender cap counts this ledger by sender + time.
create index friend_hearts_sender_created_at_idx
  on public.friend_hearts (sender_id, created_at);

-- No client access in any direction — only the SECURITY DEFINER gesture
-- path below writes or reads this table. RLS on with zero policies plus
-- explicit revokes (the S1/G5 posture: never rely on the project's
-- default ACL).
alter table public.friend_hearts enable row level security;
revoke all on table public.friend_hearts from public, anon, authenticated;

-- Adding p_kind with a default keeps every existing named-parameter call
-- site (the app passes p_circle_id/p_recipient_id/p_local_date) working
-- unchanged — but it is a new signature, so the old 3-arg function must
-- go first or PostgREST would see two candidates for a 3-arg call.
drop function public.send_friend_nudge(uuid, uuid, date);

create function public.send_friend_nudge(
  p_circle_id uuid,
  p_recipient_id uuid,
  p_local_date date,
  p_kind text default 'wave'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dedupe_key text;
  v_heart_id uuid;
  v_sender_name text;
  v_recipient_name text;
  v_sender_tz text;
  v_sender_local_today date;
  v_sender_sends_today int;
begin
  if p_kind not in ('wave', 'heart') then
    raise exception 'unknown gesture kind';
  end if;
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

  -- Per-recipient daily dedupe, PER KIND: the wave keeps its outbox
  -- dedupe_key; the heart checks its own ledger. A wave and a heart to
  -- the same friend the same day are both fine.
  if p_kind = 'wave' then
    v_dedupe_key := 'friend_nudge-' || p_recipient_id::text || '-' || p_local_date::text;
    if exists (select 1 from public.notification_outbox where dedupe_key = v_dedupe_key) then
      return 'already_nudged';
    end if;
  else
    if exists (
      select 1 from public.friend_hearts
      where recipient_id = p_recipient_id and local_date = p_local_date
    ) then
      return 'already_nudged';
    end if;
  end if;

  -- Quiet per-sender daily cap — SHARED across both gesture kinds (W1's
  -- 10/day, waves counted from their outbox rows, hearts from the
  -- ledger), against the SENDER's own local calendar day.
  select coalesce(timezone, 'UTC') into v_sender_tz from public.users where id = auth.uid();
  if v_sender_tz is null then v_sender_tz := 'UTC'; end if;
  v_sender_local_today := (now() at time zone v_sender_tz)::date;

  select
    (select count(*)
       from public.notification_outbox
      where kind = 'friend_nudge'
        and payload->>'waverId' = auth.uid()::text
        and (created_at at time zone v_sender_tz)::date = v_sender_local_today)
    + (select count(*)
         from public.friend_hearts
        where sender_id = auth.uid()
          and (created_at at time zone v_sender_tz)::date = v_sender_local_today)
  into v_sender_sends_today;

  if v_sender_sends_today >= 10 then
    return 'wave_cap_reached';
  end if;

  select coalesce(name, 'a circle-mate') into v_sender_name
  from public.users where id = auth.uid();

  select coalesce(name, 'a circle-mate') into v_recipient_name
  from public.users where id = p_recipient_id;

  if p_kind = 'wave' then
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
  else
    -- The heart's whole delivery: one ledger row (dedupe/cap
    -- bookkeeping) and one synchronous wall line. NEVER an outbox row.
    insert into public.friend_hearts (circle_id, sender_id, recipient_id, local_date)
    values (p_circle_id, auth.uid(), p_recipient_id, p_local_date)
    on conflict (recipient_id, local_date) do nothing
    returning id into v_heart_id;
    if v_heart_id is null then
      -- lost a same-moment race to another sender — same warm outcome
      -- as the dedupe check above
      return 'already_nudged';
    end if;

    insert into public.wall_messages (circle_id, user_id, body)
    values (p_circle_id, auth.uid(),
      -- Matches constants/strings.ts's wallHeartEntry(senderName, name)
      -- verbatim — the copy's source of truth stays there.
      v_sender_name || ' sent ' || v_recipient_name || ' a heart 🧡');
  end if;

  return 'sent';
end;
$$;

revoke all on function public.send_friend_nudge(uuid, uuid, date, text) from public, anon;
grant execute on function public.send_friend_nudge(uuid, uuid, date, text) to authenticated, service_role;
