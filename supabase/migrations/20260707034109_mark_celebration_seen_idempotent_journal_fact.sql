-- mark_celebration_seen previously inserted a journal_facts row on every
-- call that carried a kind+body, with no guard against a repeat call for
-- a milestone this member had already recorded — a duplicate client call
-- (retry, double effect fire) would duplicate the journal entry. Only
-- insert when p_day is actually new relative to this member's prior
-- last_celebrated_day.

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
declare
  v_previous int;
begin
  if not is_member_of_circle(p_circle_id) then
    raise exception 'not a member of this circle';
  end if;
  if p_kind is not null and p_kind not in ('rally_marker', 'major_stop') then
    raise exception 'invalid celebration kind';
  end if;

  select last_celebrated_day into v_previous
  from public.memberships
  where circle_id = p_circle_id and user_id = auth.uid();

  update public.memberships
  set last_celebrated_day = greatest(last_celebrated_day, p_day)
  where circle_id = p_circle_id and user_id = auth.uid();

  if p_kind is not null and p_body is not null and p_day > coalesce(v_previous, 0) then
    insert into public.journal_facts (user_id, circle_id, kind, body, local_date)
    values (auth.uid(), p_circle_id, p_kind, p_body, (now() at time zone 'utc')::date);
  end if;
end;
$$;
revoke all on function public.mark_celebration_seen(uuid, int, text, text) from anon, public;
grant execute on function public.mark_celebration_seen(uuid, int, text, text) to authenticated;
