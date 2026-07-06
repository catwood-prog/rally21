alter table public.users
  add column has_seen_cover_hint boolean not null default false;
