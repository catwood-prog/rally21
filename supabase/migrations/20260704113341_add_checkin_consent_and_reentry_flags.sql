alter table public.users
  add column has_seen_checkin_consent boolean not null default false,
  add column last_reentry_ack_date date;
