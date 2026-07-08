-- MOD1 (7 July): report + block — the safety floor. Warmth laws still
-- govern: reporter safety is instant/unconditional, removal stays a
-- HUMAN act (nothing auto-punishes a person). The reported person is
-- never notified a report exists and never publicly marked.

-- Same hardcoded-allowlist pattern as app_caps() — duplicated rather
-- than shared, since app_caps() is already live and this keeps the
-- blast radius of this migration to new functions only. Keep both
-- lists in sync by hand if either ever changes (same convention as
-- other cross-runtime duplicated logic in this codebase).
create or replace function public.is_founder()
returns boolean
language sql
stable
set search_path = public
as $$
  select auth.uid() in (
    '75ec0d88-27de-4227-ab62-3d049b369960', -- catherine.f.harwood@gmail.com
    '149bac2f-6557-403b-bf05-f830d42fc2e4'   -- catherine.harwood@korefusion.com (test)
  );
$$;

revoke all on function public.is_founder() from public;
revoke all on function public.is_founder() from anon;
grant execute on function public.is_founder() to authenticated;

-- reports: one mechanism, three targets (wall_message / member / circle).
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null check (target_kind in ('wall_message', 'member', 'circle')),
  target_id uuid not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'dismissed', 'actioned')),
  created_at timestamptz not null default now()
);

create index reports_target_idx on public.reports (target_kind, target_id);
create index reports_status_idx on public.reports (status) where status = 'pending';

alter table public.reports enable row level security;

create policy "a user can report their own reports"
on public.reports
for insert
to authenticated
with check (reporter_id = auth.uid());

create policy "the founder can read all reports"
on public.reports
for select
to authenticated
using (is_founder());

-- blocks: person-level, one direction per row (blocker -> blocked).
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

create policy "a user can create their own blocks"
on public.blocks
for insert
to authenticated
with check (blocker_id = auth.uid());

create policy "a user can remove their own blocks"
on public.blocks
for delete
to authenticated
using (blocker_id = auth.uid());

create policy "a user can read their own blocks"
on public.blocks
for select
to authenticated
using (blocker_id = auth.uid());

-- Moderation hiding is a DISTINCT reason from a host's own deliberate
-- closed_to_joins choice (D6/S1 already use closed_to_joins for that) —
-- a separate column avoids the founder's "unhide after review" action
-- accidentally reopening a circle its own host had deliberately closed.
alter table public.circles add column hidden_from_browse boolean not null default false;

-- wall_messages.hidden: the GLOBAL circuit-breaker (2 independent
-- reports hides for everyone, pending review) — distinct from a single
-- reporter's own permanent, instant, reporter-only hide, which is
-- handled by the SELECT policy's anti-join against the reporter's own
-- reports rows below (no column needed for that half).
alter table public.wall_messages add column hidden boolean not null default false;

drop policy "circle members can read wall messages" on public.wall_messages;
create policy "circle members can read wall messages"
on public.wall_messages
for select
to authenticated
using (
  is_member_of_circle(circle_id)
  and not hidden
  and not exists (
    select 1 from public.reports r
    where r.target_kind = 'wall_message' and r.target_id = wall_messages.id and r.reporter_id = auth.uid()
  )
  and not exists (
    select 1 from public.blocks b
    where b.blocker_id = auth.uid() and b.blocked_id = wall_messages.user_id
  )
);

drop policy "the circle creator can delete wall messages" on public.wall_messages;
create policy "the circle creator or founder can delete wall messages"
on public.wall_messages
for delete
to authenticated
using (
  exists (select 1 from public.circles c where c.id = wall_messages.circle_id and c.created_by = auth.uid())
  or is_founder()
);

drop policy "circle members can read wall message reactions" on public.wall_message_reactions;
create policy "circle members can read wall message reactions"
on public.wall_message_reactions
for select
to authenticated
using (
  exists (
    select 1 from public.wall_messages wm
    where wm.id = wall_message_reactions.message_id and is_member_of_circle(wm.circle_id)
  )
  and not exists (
    select 1 from public.blocks b
    where b.blocker_id = auth.uid() and b.blocked_id = wall_message_reactions.from_user_id
  )
);

-- list_public_circles: exclude moderation-hidden circles too.
create or replace function public.list_public_circles(p_practice_id uuid default null::uuid)
returns table(circle_id uuid, name text, practice_name text, member_count bigint, day_number integer, duration_days integer)
language sql
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    p.name,
    (select count(*) from public.memberships m where m.circle_id = c.id),
    greatest(1, (current_date - c.start_date) + 1),
    c.duration_days
  from public.circles c
  join public.practices p on p.id = c.practice_id
  where c.is_public = true
    and c.is_active = true
    and c.completed_at is null
    and c.closed_to_joins = false
    and c.hidden_from_browse = false
    and (p_practice_id is null or c.practice_id = p_practice_id)
    and not exists (
      select 1 from public.memberships m2
      where m2.circle_id = c.id and m2.user_id = auth.uid()
    )
  order by c.created_at desc;
$$;

-- remove_member_from_circle: the founder can act as an admin path too,
-- per MOD1's "reuse the existing host-removal RPC via an admin path".
create or replace function public.remove_member_from_circle(p_circle_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_remaining int;
begin
  select created_by into v_creator from public.circles where id = p_circle_id;
  if (v_creator is null or v_creator <> auth.uid()) and not is_founder() then
    raise exception 'only the circle creator can remove a member';
  end if;
  if p_member_id = auth.uid() then
    raise exception 'use leave_circle to remove yourself';
  end if;

  delete from public.memberships where circle_id = p_circle_id and user_id = p_member_id;

  select count(*) into v_remaining from public.memberships where circle_id = p_circle_id;
  if v_remaining = 0 then
    update public.circles set is_active = false where id = p_circle_id;
  end if;
end;
$$;

-- report_content: the one mechanism for all three reportable surfaces.
-- Composes nothing client-supplied beyond the free-text reason (never
-- trusted as HTML — rendered as plain text everywhere it's shown).
create or replace function public.report_content(p_target_kind text, p_target_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_count int;
begin
  if p_target_kind not in ('wall_message', 'member', 'circle') then
    raise exception 'invalid target kind';
  end if;

  insert into public.reports (reporter_id, target_kind, target_id, reason)
  values (auth.uid(), p_target_kind, p_target_id, nullif(trim(p_reason), ''));

  -- Circuit breaker: TWO INDEPENDENT reports on a wall message or a
  -- circle triggers an automatic, global pending-review hide. A
  -- reported MEMBER never triggers anything automatic — human review
  -- only, per the warmth laws (removal is always a human act).
  if p_target_kind = 'wall_message' then
    select count(distinct reporter_id) into v_report_count
    from public.reports
    where target_kind = 'wall_message' and target_id = p_target_id;
    if v_report_count >= 2 then
      update public.wall_messages set hidden = true where id = p_target_id;
    end if;
  elsif p_target_kind = 'circle' then
    select count(distinct reporter_id) into v_report_count
    from public.reports
    where target_kind = 'circle' and target_id = p_target_id;
    if v_report_count >= 2 then
      update public.circles set hidden_from_browse = true where id = p_target_id;
    end if;
  end if;
end;
$$;

revoke all on function public.report_content(text, uuid, text) from public;
revoke all on function public.report_content(text, uuid, text) from anon;
grant execute on function public.report_content(text, uuid, text) to authenticated;

-- Founder admin actions — every one is a deliberate human decision,
-- never automatic.
create or replace function public.admin_delete_wall_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_founder() then
    raise exception 'founder only';
  end if;
  delete from public.wall_messages where id = p_message_id;
end;
$$;

create or replace function public.admin_hide_circle(p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_founder() then
    raise exception 'founder only';
  end if;
  update public.circles set hidden_from_browse = true where id = p_circle_id;
end;
$$;

create or replace function public.admin_set_report_status(p_report_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_founder() then
    raise exception 'founder only';
  end if;
  if p_status not in ('pending', 'dismissed', 'actioned') then
    raise exception 'invalid status';
  end if;
  update public.reports set status = p_status where id = p_report_id;
end;
$$;

revoke all on function public.admin_delete_wall_message(uuid) from public;
revoke all on function public.admin_delete_wall_message(uuid) from anon;
grant execute on function public.admin_delete_wall_message(uuid) to authenticated;

revoke all on function public.admin_hide_circle(uuid) from public;
revoke all on function public.admin_hide_circle(uuid) from anon;
grant execute on function public.admin_hide_circle(uuid) to authenticated;

revoke all on function public.admin_set_report_status(uuid, text) from public;
revoke all on function public.admin_set_report_status(uuid, text) from anon;
grant execute on function public.admin_set_report_status(uuid, text) to authenticated;

-- get_pending_reports: founder-only read that resolves each report's
-- target content inline (wall message body + circle name, a member's
-- name + circle name, or a circle's name + practice) so the /reports
-- screen never needs a second privileged round trip.
create or replace function public.get_pending_reports()
returns table (
  report_id uuid,
  target_kind text,
  target_id uuid,
  reason text,
  created_at timestamptz,
  reporter_name text,
  wall_message_body text,
  wall_message_circle_name text,
  member_name text,
  member_circle_name text,
  circle_name text,
  circle_practice_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_founder() then
    raise exception 'founder only';
  end if;

  return query
  select
    r.id,
    r.target_kind,
    r.target_id,
    r.reason,
    r.created_at,
    ru.name,
    wm.body,
    wc.name,
    mu.name,
    mc.name,
    cc.name,
    cp.name
  from public.reports r
  left join public.users ru on ru.id = r.reporter_id
  left join public.wall_messages wm on r.target_kind = 'wall_message' and wm.id = r.target_id
  left join public.circles wc on wm.circle_id = wc.id
  left join public.users mu on r.target_kind = 'member' and mu.id = r.target_id
  left join public.memberships mm on r.target_kind = 'member' and mm.user_id = r.target_id
  left join public.circles mc on mm.circle_id = mc.id
  left join public.circles cc on r.target_kind = 'circle' and cc.id = r.target_id
  left join public.practices cp on cc.practice_id = cp.id
  where r.status = 'pending'
  order by r.created_at desc;
end;
$$;

revoke all on function public.get_pending_reports() from public;
revoke all on function public.get_pending_reports() from anon;
grant execute on function public.get_pending_reports() to authenticated;
