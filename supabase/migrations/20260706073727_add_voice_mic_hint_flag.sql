alter table public.users
  add column has_seen_voice_hint boolean not null default false;
