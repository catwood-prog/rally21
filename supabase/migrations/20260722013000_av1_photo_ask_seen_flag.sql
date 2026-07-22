-- AV1 — the one-shot photo ask (RM1's reminders_ask_seen_at pattern):
-- a quiet Today card for photo-less accounts, offered once at the
-- first check-in celebration, marked seen FOREVER on any interaction —
-- it never returns, never nags (warmth laws). Nullable timestamptz;
-- the client stamps its own row (users has an own-row UPDATE policy).
alter table public.users
  add column photo_ask_seen_at timestamptz;
