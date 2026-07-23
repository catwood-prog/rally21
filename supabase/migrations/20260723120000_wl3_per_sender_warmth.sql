-- WL3 (23 July, Cat's ruling) — every wave and every heart lands.
--
-- The bug: the live send_friend_nudge (WL1 definition) throws away every
-- gesture after the FIRST one per recipient per day. A wave hits the
-- per-recipient outbox dedupe key friend_nudge-{recipient}-{date} and
-- returns already_nudged BEFORE the recipient-private warmth row is
-- written; a heart is blocked by the friend_hearts unique index
-- (recipient_id, local_date). So only the first friend's gesture ever
-- reaches the recipient, and WL2's "for you" whisper on Today can
-- structurally never show more than one name.
--
-- That first-sender-wins cap was built for waves at a struggling member;
-- it also silently discards pure warmth on a good day, which is the bug.
-- Cat's ruling: more than one friend can wave and/or heart, and the
-- recipient sees ALL of them in-app (WL2's whisper fills with their
-- names). The dedupe repoints from per-RECIPIENT to per-SENDER-per-
-- recipient-per-kind, per day. A repeat gesture from the SAME sender the
-- same day still returns the warm already_nudged (idempotent); a
-- DIFFERENT sender now lands its own warmth row.
--
-- The phone stays protected exactly as it is: send-notifications is NOT
-- touched here (its 2/day recipient cap, not-checked-in suppression,
-- active-in-app suppression, quiet hours, opt-out all stay). This change
-- is only about letting the in-app warmth rows through.

-- ── 1. The heart's pile-on guard moves from per-recipient to per-sender ──
-- The old index enforced one heart per recipient per day regardless of
-- sender; the new one is STRICTLY LOOSER (one heart per sender→recipient
-- pair per day), so all existing rows satisfy it. Verify there are no
-- (sender, recipient, date) duplicates before swapping — the old index
-- guarantees none, but check rather than assume (WL3 verify §3).

do $$
declare
  v_dups int;
begin
  select count(*) into v_dups from (
    select sender_id, recipient_id, local_date
    from public.friend_hearts
    group by sender_id, recipient_id, local_date
    having count(*) > 1
  ) d;
  if v_dups > 0 then
    raise exception 'WL3: % (sender, recipient, date) heart duplicate group(s) exist — resolve before adding the per-sender unique index', v_dups;
  end if;
end $$;

drop index public.friend_hearts_one_per_recipient_per_day;

-- One received heart per SENDER→recipient pair per day (mirrors the
-- wave's new per-sender outbox dedupe key below). Different senders now
-- each land their own heart at the same recipient the same day.
create unique index friend_hearts_one_per_sender_recipient_per_day
  on public.friend_hearts (sender_id, recipient_id, local_date);

-- ── 2. send_friend_nudge: per-sender dedupe for both kinds ──────────────
-- Byte-for-byte the WL1 definition (kind + recipient_id stamped on the
-- wall inserts, wave outbox untouched) EXCEPT the two dedupe checks and
-- the heart's ON CONFLICT target, which now key on the sender as well.

create or replace function public.send_friend_nudge(
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

  -- WL3: per-SENDER-per-recipient-per-kind daily dedupe. A repeat of the
  -- SAME kind from the SAME sender the same day returns the warm
  -- already_nudged (idempotent); a DIFFERENT sender's gesture proceeds
  -- and writes its own outbox/ledger row AND its own warmth row, so WL2's
  -- whisper fills with every distinct sender's name. A wave and a heart
  -- to the same friend the same day are both still fine (per-kind).
  if p_kind = 'wave' then
    v_dedupe_key := 'friend_nudge-' || auth.uid()::text || '-' || p_recipient_id::text || '-' || p_local_date::text;
    if exists (select 1 from public.notification_outbox where dedupe_key = v_dedupe_key) then
      return 'already_nudged';
    end if;
  else
    if exists (
      select 1 from public.friend_hearts
      where sender_id = auth.uid() and recipient_id = p_recipient_id and local_date = p_local_date
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

    -- WL1: recipient-private — never rendered on the wall, delivered by
    -- WL2's surfaces instead.
    insert into public.wall_messages (circle_id, user_id, body, kind, recipient_id)
    values (p_circle_id, auth.uid(),
      v_sender_name || ' waved at ' || v_recipient_name || ' 👋',
      'wave', p_recipient_id);
  else
    -- The heart's whole delivery: one ledger row (dedupe/cap
    -- bookkeeping) and one synchronous, recipient-private line. NEVER an
    -- outbox row.
    insert into public.friend_hearts (circle_id, sender_id, recipient_id, local_date)
    values (p_circle_id, auth.uid(), p_recipient_id, p_local_date)
    on conflict (sender_id, recipient_id, local_date) do nothing
    returning id into v_heart_id;
    if v_heart_id is null then
      -- lost a same-moment race to my OWN duplicate (same sender, same
      -- day) — same warm outcome as the dedupe check above
      return 'already_nudged';
    end if;

    insert into public.wall_messages (circle_id, user_id, body, kind, recipient_id)
    values (p_circle_id, auth.uid(),
      -- Matches constants/strings.ts's wallHeartEntry(senderName, name)
      -- verbatim — the copy's source of truth stays there.
      v_sender_name || ' sent ' || v_recipient_name || ' a heart 🧡',
      'heart', p_recipient_id);
  end if;

  return 'sent';
end;
$$;

revoke all on function public.send_friend_nudge(uuid, uuid, date, text) from public, anon;
grant execute on function public.send_friend_nudge(uuid, uuid, date, text) to authenticated, service_role;
