-- Fix: a report on a MEMBER needs to know WHICH circle the reporter saw
-- them in — without it, get_pending_reports()'s join through
-- memberships fans out into duplicate rows for anyone in 2+ circles,
-- and the founder's "remove from circle" act button has no circle to
-- act on (remove_member_from_circle needs both circle_id and member_id).
alter table public.reports add column context_circle_id uuid references public.circles(id) on delete set null;

create or replace function public.report_content(
  p_target_kind text,
  p_target_id uuid,
  p_reason text default null,
  p_context_circle_id uuid default null
)
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

  insert into public.reports (reporter_id, target_kind, target_id, reason, context_circle_id)
  values (auth.uid(), p_target_kind, p_target_id, nullif(trim(p_reason), ''), p_context_circle_id);

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

revoke all on function public.report_content(text, uuid, text, uuid) from public;
revoke all on function public.report_content(text, uuid, text, uuid) from anon;
grant execute on function public.report_content(text, uuid, text, uuid) to authenticated;

drop function if exists public.report_content(text, uuid, text);
drop function if exists public.get_pending_reports();

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
  member_circle_id uuid,
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
    r.context_circle_id,
    mc.name,
    cc.name,
    cp.name
  from public.reports r
  left join public.users ru on ru.id = r.reporter_id
  left join public.wall_messages wm on r.target_kind = 'wall_message' and wm.id = r.target_id
  left join public.circles wc on wm.circle_id = wc.id
  left join public.users mu on r.target_kind = 'member' and mu.id = r.target_id
  left join public.circles mc on r.target_kind = 'member' and mc.id = r.context_circle_id
  left join public.circles cc on r.target_kind = 'circle' and cc.id = r.target_id
  left join public.practices cp on cc.practice_id = cp.id
  where r.status = 'pending'
  order by r.created_at desc;
end;
$$;

revoke all on function public.get_pending_reports() from public;
revoke all on function public.get_pending_reports() from anon;
grant execute on function public.get_pending_reports() to authenticated;
