-- 1. Blueprint versions: stores each synthesized blueprint snapshot per user
create table public.blueprint_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  version integer not null,
  content jsonb not null default '{}'::jsonb,
  source text not null default 'system' check (source in ('system', 'user_edit')),
  generated_at timestamptz not null default now(),
  unique (user_id, version)
);

alter table public.blueprint_versions enable row level security;

-- Users can read their own blueprint history. Writes are reserved for
-- server-side generation (service role bypasses RLS), so no insert/update
-- policies are created for clients yet.
create policy "a user can read their own blueprint versions"
  on public.blueprint_versions
  for select
  to authenticated
  using (user_id = auth.uid());

create index blueprint_versions_user_latest_idx
  on public.blueprint_versions (user_id, version desc);

-- 2. Device tokens: APNs (and future FCM/web) push registration per device
create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('apns', 'fcm', 'webpush')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.device_tokens enable row level security;

create policy "a user can read their own device tokens"
  on public.device_tokens
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "a user can register their own device token"
  on public.device_tokens
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "a user can update their own device token"
  on public.device_tokens
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "a user can remove their own device token"
  on public.device_tokens
  for delete
  to authenticated
  using (user_id = auth.uid());

create index device_tokens_user_idx on public.device_tokens (user_id);

-- 3. Questions: archive flag so retiring a question never requires deleting it
alter table public.questions
  add column is_archived boolean not null default false;

-- 4. Missing indexes on hot query paths (Postgres does not auto-index FKs)
create index wall_messages_circle_recent_idx
  on public.wall_messages (circle_id, created_at desc);

create index memberships_user_idx
  on public.memberships (user_id);
