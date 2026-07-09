-- T1 — the timer's "keep this screen open" one-shot hint, tracked the
-- same way as every other one-shot hint in this app (has_seen_voice_hint,
-- has_seen_cover_hint): a single boolean flag flipped once the user has
-- dismissed it, so it shows at most once ever, not once per device/session.
--
-- No new function is introduced here, so there is nothing to grant/revoke
-- (S1/G5 conventions apply to functions) — this column rides the existing
-- self-UPDATE policy (id = auth.uid()) the same way has_seen_voice_hint
-- and has_seen_cover_hint already do.

alter table public.users
  add column has_seen_timer_background_hint boolean not null default false;
