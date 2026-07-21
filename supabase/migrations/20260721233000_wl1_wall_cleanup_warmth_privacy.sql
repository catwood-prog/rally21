-- WL1 (21 July, Cat's rulings) — the wall becomes a conversation.
--
-- Three rulings land here:
-- 1. Check-in rows leave the wall (that cut is client-side — they were
--    always derived from completions at render time, never stored), and
--    their curated emoji reaction strip RETIRES ENTIRELY: the
--    checkin_reactions table and its existing rows STAY (historical
--    data, no destructive migration — ledgered in CODE-AUDIT-JULY.md
--    for CH5), but every write policy is dropped so no new rows can
--    appear even from a stale client. Who's Here's heart/wave pills are
--    the per-member cheering surface now. Reactions on HUMAN posts
--    (wall_message_reactions) survive untouched.
-- 2. The wall keeps human posts + system celebration lines only, so
--    wall_messages grows a `kind` discriminator ('post' | 'celebration'
--    | 'wave' | 'heart') — celebrations stay public (that is their
--    point), warmth goes private.
-- 3. Hearts/waves go RECIPIENT-PRIVATE, enforced at the database (the
--    G4/G5 leak-class rule — never a client filter): warmth rows carry
--    recipient_id and the SELECT policy scopes them to that recipient
--    alone. The wave's outbox nudge (email/push) is untouched.
--
-- The warmth law this serves: public affection is countable, and anyone
-- at zero can see it; nobody is at zero in public if there is no
-- public.

-- ── 1. wall_messages grows a kind + recipient ──────────────────────────

alter table public.wall_messages
  add column kind text not null default 'post'
    check (kind in ('post', 'celebration', 'wave', 'heart')),
  add column recipient_id uuid references public.users (id) on delete cascade;

-- recipient_id is meaningful only on warmth kinds. One-directional on
-- purpose: a historic wave/heart row whose recipient can't be recovered
-- keeps a null recipient (visible to no one — matching the ruling that
-- warmth stops rendering on the wall for anyone).
alter table public.wall_messages
  add constraint wall_messages_recipient_only_on_warmth
  check (recipient_id is null or kind in ('wave', 'heart'));

-- WL2 reads "my warmth since last seen" — give it the scoped index now.
create index wall_messages_recipient_recent_idx
  on public.wall_messages (recipient_id, created_at desc)
  where recipient_id is not null;

-- ── 2. Backfill kinds for the rows the server composed ─────────────────
-- Every server-written line has carried the same fixed copy since day
-- one (the pre-S1 client-composed wave used wallWaveEntry — the exact
-- same string), so the patterns are exhaustive.

update public.wall_messages set kind = 'wave'
  where body like '% waved at % 👋';
update public.wall_messages set kind = 'heart'
  where body like '% sent % a heart 🧡';
update public.wall_messages set kind = 'celebration'
  where body like '% has been glowing % days 🔥';

-- Warmth recipients are recoverable exactly: the ledger/outbox row and
-- the wall line were inserted in the same transaction, so created_at
-- (transaction now()) matches to the microsecond.
update public.wall_messages wm
set recipient_id = fh.recipient_id
from public.friend_hearts fh
where wm.kind = 'heart' and wm.recipient_id is null
  and fh.circle_id = wm.circle_id
  and fh.sender_id = wm.user_id
  and fh.created_at = wm.created_at;

update public.wall_messages wm
set recipient_id = nb.user_id
from public.notification_outbox nb
where wm.kind = 'wave' and wm.recipient_id is null
  and nb.kind = 'friend_nudge'
  and nb.payload->>'waverId' = wm.user_id::text
  and nb.created_at = wm.created_at;

-- ── 3. Recipient-scoped visibility, at the database ────────────────────
-- MOD1's three read guards (global hidden flag, the reporter's own
-- permanent anti-join, blocks) carry over verbatim and now apply to
-- every kind — reporting a celebration line still hides it for the
-- reporter instantly, and a blocked sender's warmth never reaches you.

drop policy "circle members can read wall messages" on public.wall_messages;
create policy "circle members can read wall messages"
on public.wall_messages
for select
to authenticated
using (
  (
    (kind in ('post', 'celebration') and is_member_of_circle(circle_id))
    or (kind in ('wave', 'heart') and recipient_id = auth.uid())
  )
  and not hidden
  and not exists (
    select 1 from public.reports r
    where r.target_kind = 'wall_message' and r.target_id = wall_messages.id and r.reporter_id = auth.uid()
  )
  and not exists (
    select 1 from public.blocks b
    where b.blocker_id = auth.uid() and b.blocked_id = wall_messages.user_id
  )
);

-- Clients only ever author plain posts — wave/heart/celebration rows
-- are born inside SECURITY DEFINER paths (send_friend_nudge,
-- check_glow_milestone), which bypass RLS. Without this pin a member
-- could forge kind='heart' at a chosen recipient and spoof WL2's
-- private whisper. The OC1 earned-voice gate is otherwise unchanged.
drop policy if exists "circle members can post wall messages" on public.wall_messages;
create policy "circle members can post wall messages"
  on public.wall_messages
  for insert
  with check (
    kind = 'post'
    and recipient_id is null
    and user_id = auth.uid()
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

-- ── 4. Warmth rows are born with their kind + recipient ────────────────
-- send_friend_nudge: byte-for-byte HW1's function except the two wall
-- inserts, which now stamp kind + recipient_id. The wave's outbox row
-- (email/push nudge) is untouched.

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
    on conflict (recipient_id, local_date) do nothing
    returning id into v_heart_id;
    if v_heart_id is null then
      -- lost a same-moment race to another sender — same warm outcome
      -- as the dedupe check above
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

-- check_glow_milestone: byte-for-byte GS1's function except the huddle
-- wall lines are stamped kind='celebration' (public is their point —
-- they stay on the wall).

create or replace function public.check_glow_milestone()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_glow int;
  v_already int;
  v_milestone int;
  v_name text;
  m int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select glow into v_glow from public.get_my_glow();
  select max_glow_milestone_celebrated into v_already from public.users where id = v_user;

  v_milestone := null;
  foreach m in array array[7, 21, 50, 100, 365] loop
    if m <= v_glow and m > v_already then
      v_milestone := m;
    end if;
  end loop;

  if v_milestone is null then
    return null;
  end if;

  -- The atomic gate: only the ONE call that actually advances the
  -- tracker celebrates — a concurrent duplicate finds no row to update
  -- and returns null, so the wall lines below can never double-write.
  update public.users
  set max_glow_milestone_celebrated = v_milestone
  where id = v_user and max_glow_milestone_celebrated < v_milestone;
  if not found then
    return null;
  end if;

  insert into public.journal_facts (user_id, circle_id, kind, body, local_date)
  values (
    v_user, null, 'glow_milestone',
    'hit ' || v_milestone || ' days glowing on ' || to_char(now(), 'FMMonth FMDD, YYYY'),
    (now() at time zone 'utc')::date
  );

  -- GS1: one warm line on each of this member's active circles' walls —
  -- copy composed server-side; matches constants/strings.ts's
  -- glowSocialWallLine reference copy verbatim. Completed/archived
  -- circles stay quiet. Exactly-once is inherited from the atomic gate
  -- above. Pride-only copy; a reset is never announced anywhere.
  select coalesce(name, 'someone in your circle') into v_name from public.users where id = v_user;

  insert into public.wall_messages (circle_id, user_id, body, kind)
  select ms.circle_id, v_user,
         v_name || ' has been glowing ' || v_milestone || ' days 🔥',
         'celebration'
  from public.memberships ms
  join public.circles c on c.id = ms.circle_id
  where ms.user_id = v_user
    and c.is_active
    and c.completed_at is null;

  return v_milestone;
end;
$$;

revoke all on function public.check_glow_milestone() from public;
revoke all on function public.check_glow_milestone() from anon;
grant execute on function public.check_glow_milestone() to authenticated;

-- ── 5. checkin_reactions retires ───────────────────────────────────────
-- Table and rows stay (historical data — CH5 owns any eventual
-- disposal). No new writes, even from a stale client still running the
-- old UI; the read policy stays so nothing that might still hold a
-- reference breaks. No live subscriber remains, so it leaves the
-- realtime publication too.

drop policy "circle members can react" on public.checkin_reactions;
drop policy "a user can change their own reaction" on public.checkin_reactions;
drop policy "a user can remove their own reaction" on public.checkin_reactions;

alter publication supabase_realtime drop table public.checkin_reactions;
