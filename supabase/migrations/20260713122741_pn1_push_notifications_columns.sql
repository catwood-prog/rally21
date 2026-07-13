-- PN1: push as a new delivery channel on the existing notification_outbox
-- row (never a parallel system). push_ticket_id/push_token/
-- push_receipt_checked_at back a two-phase Expo push flow: send-notifications
-- records the Expo "ticket" id + the token used at send time, then a later
-- invocation checks that ticket's real delivery receipt and prunes the
-- token if Expo reports it as DeviceNotRegistered.
alter table public.notification_outbox
  add column push_ticket_id text null,
  add column push_token text null,
  add column push_receipt_checked_at timestamptz null;

-- One-time, ever, pre-permission "why" prompt shown at an earned moment
-- (check-in success) — same one-shot pattern as has_seen_voice_hint etc.
-- The real OS permission decision (granted/denied) is tracked by iOS
-- itself, not here; this flag only gates OUR OWN soft ask card so it
-- never re-nags once dismissed, even while the OS status stays
-- 'undetermined'.
alter table public.users
  add column has_seen_push_prompt boolean not null default false;
