-- Stores a user's "Sounds right / Not quite" response to a day-14-style
-- reflected observation. Owner-only, like the reflections themselves —
-- this is part of the private picture, never circle-visible.
create table public.observation_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  pattern_type text not null check (pattern_type in ('time_of_day', 'weekday')),
  direction text not null,
  agreement_count int not null,
  total_count int not null,
  response text not null check (response in ('confirmed', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.observation_responses enable row level security;

create policy "a user can read their own observation responses"
  on public.observation_responses for select
  to authenticated
  using (user_id = auth.uid());

create policy "a user can save their own observation responses"
  on public.observation_responses for insert
  to authenticated
  with check (user_id = auth.uid());
