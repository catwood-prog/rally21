-- last_seen_at: stamped on app open/focus, drives digest "seen it" suppression
alter table public.users
  add column last_seen_at timestamptz null;

-- notification_prefs: one row per user, defaults match the spec (everything on)
create table public.notification_prefs (
  user_id uuid primary key references public.users(id) on delete cascade,
  nudge_enabled boolean not null default true,
  nudge_time time without time zone null,
  digest_enabled boolean not null default true,
  friend_nudge_enabled boolean not null default true,
  quiet_start time without time zone not null default '22:00',
  quiet_end time without time zone not null default '08:00',
  created_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

create policy "a user can read their own notification prefs"
  on public.notification_prefs
  for select
  using (user_id = auth.uid());

create policy "a user can update their own notification prefs"
  on public.notification_prefs
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Backfill existing users with a default-prefs row.
insert into public.notification_prefs (user_id)
select id from public.users
on conflict (user_id) do nothing;

-- New signups get a prefs row for free, same trigger that creates public.users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.users (id) values (new.id);
  insert into public.notification_prefs (user_id) values (new.id);
  return new;
end;
$function$;

-- notification_outbox: service-role only (RLS enabled, zero policies — no
-- anon/authenticated role can touch it under any circumstance; the sender
-- edge function uses the service-role key, which bypasses RLS entirely).
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('nudge_daily', 'social_digest', 'friend_nudge')),
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null,
  sent_at timestamptz null,
  -- Set when the sender job processed the row but chose not to deliver it
  -- (already checked in, already seen in-app, pref off) — distinguishes
  -- "delivered" from "correctly suppressed" without ever retrying either.
  suppressed_reason text null,
  channel text not null default 'email' check (channel in ('email', 'webpush', 'apns')),
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);

alter table public.notification_outbox enable row level security;

create index notification_outbox_due_idx
  on public.notification_outbox (scheduled_for)
  where sent_at is null and suppressed_reason is null;
