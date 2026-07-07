-- B3: tracks when a confirmed blueprint want becomes a real practice
-- circle ("make this your next 21 days"). Deliberately separate from
-- blueprint_versions (owned by compose-blueprint, service-role only,
-- versioned/immutable-ish) — this is small, client-writable, append-only
-- bookkeeping: one row per want a user has ever acted on. want_statement
-- is denormalized (copied at activation time) so the archive/history copy
-- never drifts if a later blueprint version rewords or retires the want.
create table public.want_activations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  want_key text not null,
  want_statement text not null,
  circle_id uuid not null references public.circles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, want_key)
);

alter table public.want_activations enable row level security;

create policy "a user can create their own want activation"
  on public.want_activations for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "a user can read their own want activations"
  on public.want_activations for select
  to authenticated
  using (user_id = auth.uid());
