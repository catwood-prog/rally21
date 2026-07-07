-- A1: Ask Rally, the real thing (Rally21-Ask-Rally-Spec.md §6 privacy
-- architecture). Owner-only RLS both directions on both tables — no
-- service role needed anywhere in the ask-rally edge function, since
-- every table it touches (these two, plus blueprint_versions,
-- reflections, completions, circles/memberships) is already scoped to
-- auth.uid() by RLS. A hard delete (no soft-delete column anywhere) is
-- just DELETE ... CASCADE, enforced by the FK, not application code.
create table public.ask_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

-- "ONE active thread" (spec §6) enforced at the DB level, not just client
-- discipline — a second concurrent insert of an open conversation for the
-- same user simply fails the constraint.
create unique index one_active_ask_conversation_per_user
  on public.ask_conversations (user_id)
  where closed_at is null;

alter table public.ask_conversations enable row level security;

create policy "a user can create their own ask conversation"
  on public.ask_conversations for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "a user can read their own ask conversations"
  on public.ask_conversations for select
  to authenticated
  using (user_id = auth.uid());

create policy "a user can close their own ask conversation"
  on public.ask_conversations for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "a user can delete their own ask conversation"
  on public.ask_conversations for delete
  to authenticated
  using (user_id = auth.uid());

create table public.ask_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ask_conversations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index ask_messages_conversation_id_idx on public.ask_messages (conversation_id, created_at);
create index ask_messages_user_id_created_at_idx on public.ask_messages (user_id, created_at);

alter table public.ask_messages enable row level security;

create policy "a user can create their own ask messages"
  on public.ask_messages for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "a user can read their own ask messages"
  on public.ask_messages for select
  to authenticated
  using (user_id = auth.uid());
