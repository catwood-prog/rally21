-- AE1 job 3c (26 Aug) — a responsibility should not arrive unannounced.
--
-- HT1 (23 Aug) made a creator's leave hand the circle to the earliest
-- remaining member, matching what account deletion had always done. Cat's
-- ruling at HT1's job-3 stop: the transfer stays silent — no prompt, no
-- ceremony — but the successor should MEET the controls rather than
-- discover them. This is that meeting: a one-time note on the host-controls
-- card, saying what the card now lets them do.
--
-- THE PATTERN IS THE EXISTING ONE, NOT A NEW ONE. `has_seen_push_prompt`'s
-- family: a boolean flag plus a narrow mark-seen RPC. The per-CIRCLE member
-- of that family is `memberships.has_seen_voice_unlocked_hint` +
-- `mark_voice_unlocked_hint_seen` (20260706163036), and this follows it
-- exactly, for the same reason it exists: memberships has no self-UPDATE
-- RLS policy and must not get one, because `memberships.role` carries an
-- 'owner' value and an open policy would let a member self-promote.
--
-- WHY THE FLAG IS "PENDING" RATHER THAN "has_seen". The other one-shots
-- answer "have they met this yet?" for something everyone eventually
-- meets. This one must first know the person ARRIVED BY TRANSFER at all —
-- a creator who made their own circle is owed nothing. So the flag is
-- raised by the transfer and lowered when the note is met: false is the
-- resting state at both ends, and default false means nobody who never
-- received a circle can ever be shown it.
--
-- DELIBERATELY NOT BACKFILLED. Circles already handed on before today
-- (HT1 shipped 23 Aug) stay at false. A note that announces a
-- responsibility someone has already been carrying for days is not the
-- meeting Cat ruled — it is a surprise about the past.

alter table public.memberships
  add column if not exists host_handover_note_pending boolean not null default false;

comment on column public.memberships.host_handover_note_pending is
  'AE1 — true from the moment transfer_circle_host hands this circle to this member, until they meet the one-time note on the host-controls card. Never set for a creator who made the circle themselves.';

-- 1. The transfer raises the flag. This is the ONLY writer of true, which
--    is what makes the note mean "you arrived by transfer" and not merely
--    "you are the host". Everything above the new statement is byte-identical
--    to HT1's shipped definition, read back from pg_proc before this was
--    written rather than copied from the migration file.
create or replace function public.transfer_circle_host(
  p_circle_id uuid,
  p_departing_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_successor uuid;
begin
  -- The successor is the earliest remaining member by joined_at, ties
  -- broken by user_id so the choice is deterministic, and the person on
  -- their way out is excluded BY NAME rather than by absence — which is
  -- what lets leave_circle call this BEFORE it deletes the membership row.
  select m.user_id into v_successor
    from public.memberships m
   where m.circle_id = p_circle_id
     and m.user_id <> p_departing_user_id
   order by m.joined_at asc, m.user_id asc
   limit 1;

  -- Nobody remains: hand back null and let the caller decide what that
  -- means (leave_circle deactivates; delete_account_prep never asks,
  -- because its own branch (b) has already excluded this shape).
  if v_successor is null then
    return null;
  end if;

  update public.circles set created_by = v_successor where id = p_circle_id;

  -- AE1 — the successor is owed the note. Both callers (leave_circle and
  -- delete_account_prep) inherit it from here, which is the whole point of
  -- HT1 having extracted one rule into one place.
  update public.memberships
     set host_handover_note_pending = true
   where circle_id = p_circle_id
     and user_id = v_successor;

  return v_successor;
end;
$function$;

-- The ACL is restated rather than assumed: create or replace preserves it,
-- but HD4 records that this project's default privileges merge
-- authenticated=X onto new functions regardless of what a migration grants,
-- and a caller holding EXECUTE here could reassign the host of ANY circle.
revoke all on function public.transfer_circle_host(uuid, uuid) from public;
revoke all on function public.transfer_circle_host(uuid, uuid) from anon;
revoke all on function public.transfer_circle_host(uuid, uuid) from authenticated;

-- 2. The mark-seen RPC — mark_voice_unlocked_hint_seen's exact shape.
--    Flips only this column, only on the caller's own membership row.
create or replace function public.mark_host_handover_note_seen(p_circle_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.memberships
  set host_handover_note_pending = false
  where circle_id = p_circle_id and user_id = auth.uid();
$$;

revoke all on function public.mark_host_handover_note_seen(uuid) from public, anon;
grant execute on function public.mark_host_handover_note_seen(uuid) to authenticated;
