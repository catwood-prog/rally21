-- SK1 (24 July) — reflections become optional.
--
-- Cat's ruling (23 July, from the live check-in screen): the reflection
-- step must never be the reason someone drops off. "just check-ins for
-- me" is a permanent, reversible preference — the check-in itself always
-- counts either way (glow, embers, covers, wall, ceremonies: identical).
--
-- USER-level, not membership-level: reflections are one-per-person-per-
-- day and span every circle (Rally21_MultiCircle_Spec), so a per-circle
-- flag would be incoherent the moment someone is in two circles.
--
-- NOT NULL default false, no backfill needed by construction — every
-- existing row simply reads false, which is today's behaviour exactly.
--
-- Own-row write rides the existing "users can update their own profile"
-- UPDATE policy, like every other profile preference (sounds_enabled,
-- celebrate_birthday, has_seen_voice_hint). No new policy, no new RPC:
-- the client stamps its own row and nothing else ever writes it.
alter table public.users
  add column reflections_opt_out boolean not null default false;

comment on column public.users.reflections_opt_out is
  'SK1 — "just check-ins for me". When true the check-in screen is skipped entirely (one-tap flow) and no surface may mention reflections unprompted (the no-nag law); journal / private map / ask Rally carry the inline way back in.';
