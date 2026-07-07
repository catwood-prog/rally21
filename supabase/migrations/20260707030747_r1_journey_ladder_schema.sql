-- R1: circles stop ending at day 21 — same circle row, no reset.
-- Spec: ../Rally21-Glow-Spec.md §8.

alter table public.circles
  add column completed_at timestamptz null,
  add column rallied_on_at timestamptz null;

alter table public.memberships
  add column last_celebrated_day int not null default 0;

-- System-generated journal entries (day-21 completion, rally markers,
-- major stops) — additive facts in the private journal timeline,
-- distinct from user-written reflections. Owner-only, server-written
-- only (SECURITY DEFINER RPCs use service-definer privilege to insert;
-- no insert policy for clients).
create table public.journal_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  circle_id uuid null references public.circles(id) on delete set null,
  kind text not null check (kind in ('circle_completed', 'rally_marker', 'major_stop')),
  body text not null,
  local_date date not null,
  created_at timestamptz not null default now()
);

alter table public.journal_facts enable row level security;

create policy "a user can read their own journal facts"
  on public.journal_facts
  for select
  to authenticated
  using (user_id = auth.uid());

-- Any member can rally on (first tap wins, idempotent) — can't rally on
-- an already-completed circle. Doesn't gate on day >= 21 itself; the UI
-- only ever shows the button once eligible, and re-tapping after someone
-- else already answered is a harmless no-op.
create or replace function public.rally_on_circle(p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_member_of_circle(p_circle_id) then
    raise exception 'not a member of this circle';
  end if;
  update public.circles
  set rallied_on_at = now()
  where id = p_circle_id
    and rallied_on_at is null
    and completed_at is null;
end;
$$;
revoke all on function public.rally_on_circle(uuid) from anon, public;
grant execute on function public.rally_on_circle(uuid) to authenticated;

-- Creator-only, any time (day 21 or later host controls). Idempotent —
-- re-running after it's already completed is a no-op, never writes a
-- second round of journal facts.
create or replace function public.complete_circle(p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_circle_name text;
  v_already_completed timestamptz;
begin
  select created_by, name, completed_at into v_creator, v_circle_name, v_already_completed
  from public.circles where id = p_circle_id;

  if v_creator is null or v_creator <> auth.uid() then
    raise exception 'only the circle creator can complete this circle';
  end if;
  if v_already_completed is not null then
    return;
  end if;

  update public.circles set completed_at = now() where id = p_circle_id;

  insert into public.journal_facts (user_id, circle_id, kind, body, local_date)
  select m.user_id, p_circle_id, 'circle_completed',
    'completed 21 days with ' || v_circle_name || ' on ' || to_char(now(), 'FMMonth FMDD, YYYY'),
    (now() at time zone 'utc')::date
  from public.memberships m
  where m.circle_id = p_circle_id;
end;
$$;
revoke all on function public.complete_circle(uuid) from anon, public;
grant execute on function public.complete_circle(uuid) to authenticated;

-- Records a celebration (day-21 gate, rally marker, or major stop) as
-- seen by the caller for their own membership row, and — for rally
-- markers / major stops only — writes the matching journal fact for
-- just that one member (the day-21 gate's own completion fact is
-- written for everyone at once by complete_circle; rally-on itself
-- writes no per-member fact, only the circle-level rallied_on_at).
-- never regresses last_celebrated_day, so a stale/out-of-order client
-- call can't undo a later celebration.
create or replace function public.mark_celebration_seen(
  p_circle_id uuid,
  p_day int,
  p_kind text default null,
  p_body text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_member_of_circle(p_circle_id) then
    raise exception 'not a member of this circle';
  end if;
  if p_kind is not null and p_kind not in ('rally_marker', 'major_stop') then
    raise exception 'invalid celebration kind';
  end if;

  update public.memberships
  set last_celebrated_day = greatest(last_celebrated_day, p_day)
  where circle_id = p_circle_id and user_id = auth.uid();

  if p_kind is not null and p_body is not null then
    insert into public.journal_facts (user_id, circle_id, kind, body, local_date)
    values (auth.uid(), p_circle_id, p_kind, p_body, (now() at time zone 'utc')::date);
  end if;
end;
$$;
revoke all on function public.mark_celebration_seen(uuid, int, text, text) from anon, public;
grant execute on function public.mark_celebration_seen(uuid, int, text, text) to authenticated;
