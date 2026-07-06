-- Free-text messages, circle-visible by design (unlike checkins, this
-- content is meant to be shared) so RLS-gated realtime works directly
-- here without a presence-table workaround.
create table public.wall_messages (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.wall_messages enable row level security;

create policy "circle members can read wall messages"
  on public.wall_messages for select
  to authenticated
  using (public.is_member_of_circle(circle_id));

create policy "circle members can post wall messages"
  on public.wall_messages for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_member_of_circle(circle_id));

-- reactions target a (circle, person, day) check-in event via the existing
-- content-free presence table, never the private checkins row itself.
create table public.checkin_reactions (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  target_user_id uuid not null,
  target_local_date date not null,
  from_user_id uuid not null references public.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (circle_id, target_user_id, target_local_date, from_user_id),
  foreign key (circle_id, target_user_id, target_local_date)
    references public.checkin_presence (circle_id, user_id, local_date) on delete cascade
);

alter table public.checkin_reactions enable row level security;

create policy "circle members can read reactions"
  on public.checkin_reactions for select
  to authenticated
  using (public.is_member_of_circle(circle_id));

create policy "circle members can react"
  on public.checkin_reactions for insert
  to authenticated
  with check (from_user_id = auth.uid() and public.is_member_of_circle(circle_id));

create policy "a user can change their own reaction"
  on public.checkin_reactions for update
  to authenticated
  using (from_user_id = auth.uid());

create policy "a user can remove their own reaction"
  on public.checkin_reactions for delete
  to authenticated
  using (from_user_id = auth.uid());

alter publication supabase_realtime add table public.wall_messages;
alter publication supabase_realtime add table public.checkin_reactions;
