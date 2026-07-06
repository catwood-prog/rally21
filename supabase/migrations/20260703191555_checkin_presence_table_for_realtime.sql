-- postgres_changes enforces RLS per-subscriber against the actual table
-- being watched, so subscribing to `checkins` directly would mean each
-- circle member only ever sees their OWN inserts (checkins RLS is
-- owner-only, by design — mood/line/answers stay private). To let
-- circle-mates see *presence* live (not content), presence needs its own
-- table with its own, more permissive RLS — content and presence must be
-- separate tables, not just separate queries, for realtime to work safely.
create table public.checkin_presence (
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  local_date date not null,
  created_at timestamptz not null default now(),
  primary key (circle_id, user_id, local_date)
);

alter table public.checkin_presence enable row level security;

create policy "circle members can see their circle's presence"
  on public.checkin_presence for select
  to authenticated
  using (public.is_member_of_circle(circle_id));

-- written only via the trigger below, never directly by clients
create function public.sync_checkin_presence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.checkin_presence (circle_id, user_id, local_date)
  values (new.circle_id, new.user_id, new.local_date)
  on conflict (circle_id, user_id, local_date) do nothing;
  return new;
end;
$$;

create trigger checkins_sync_presence
  after insert on public.checkins
  for each row execute function public.sync_checkin_presence();

-- backfill presence for check-ins that already exist
insert into public.checkin_presence (circle_id, user_id, local_date)
select circle_id, user_id, local_date from public.checkins
on conflict (circle_id, user_id, local_date) do nothing;

-- the old RPC read checkins directly (correctly RLS-locked to the caller's
-- own rows) and is no longer used now that presence has its own table.
drop function public.get_checkin_presence(uuid);

alter publication supabase_realtime add table public.checkin_presence;
