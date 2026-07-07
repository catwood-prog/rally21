-- The mute preference started scoped to just the check-in timer; M1
-- (mascot brief) adds a second sound (check-in success chime) governed
-- by the same single "App sounds" setting, so this generalizes the flag
-- and flips its polarity to the positive framing (enabled, default true)
-- rather than stacking a second toggle.
alter table public.users rename column timer_sound_muted to sounds_enabled;
update public.users set sounds_enabled = not sounds_enabled;
alter table public.users alter column sounds_enabled set default true;
