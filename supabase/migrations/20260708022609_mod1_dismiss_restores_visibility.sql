-- Fix: dismissing a report must restore visibility for everyone except
-- the reporter(s) who triggered the global hide — the reporter's own
-- permanent per-reporter anti-join (wall_messages SELECT policy) is a
-- separate mechanism and is untouched here. My first draft only updated
-- reports.status, which contradicted the spec's own VERIFY requirement:
-- "dismiss → visible again (except to reporters)".
create or replace function public.admin_set_report_status(p_report_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_kind text;
  v_target_id uuid;
begin
  if not is_founder() then
    raise exception 'founder only';
  end if;
  if p_status not in ('pending', 'dismissed', 'actioned') then
    raise exception 'invalid status';
  end if;

  select target_kind, target_id into v_target_kind, v_target_id from public.reports where id = p_report_id;

  update public.reports set status = p_status where id = p_report_id;

  if p_status = 'dismissed' then
    if v_target_kind = 'wall_message' then
      update public.wall_messages set hidden = false where id = v_target_id;
    elsif v_target_kind = 'circle' then
      update public.circles set hidden_from_browse = false where id = v_target_id;
    end if;
  end if;
end;
$$;

revoke all on function public.admin_set_report_status(uuid, text) from public;
revoke all on function public.admin_set_report_status(uuid, text) from anon;
grant execute on function public.admin_set_report_status(uuid, text) to authenticated;
