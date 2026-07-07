-- G3: glow milestones (Rally21-Glow-Spec.md §4). Detected at check-in
-- time via check_glow_milestone(), NOT on every get_my_glow() read (that
-- RPC stays read-only — this one has the side effect). A monotonic
-- tracker (never regresses, same pattern as R1's mark_celebration_seen
-- fix) means a milestone can never refire, including after an
-- ember-rekindle happens to pass back through an already-celebrated one.

alter table public.journal_facts
  drop constraint journal_facts_kind_check,
  add constraint journal_facts_kind_check
    check (kind in ('circle_completed', 'rally_marker', 'major_stop', 'glow_milestone'));

alter table public.users
  add column max_glow_milestone_celebrated int not null default 0;

create or replace function public.check_glow_milestone()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_glow int;
  v_already int;
  v_milestone int;
  m int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select glow into v_glow from public.get_my_glow();
  select max_glow_milestone_celebrated into v_already from public.users where id = v_user;

  v_milestone := null;
  foreach m in array array[7, 21, 50, 100, 365] loop
    if m <= v_glow and m > v_already then
      v_milestone := m;
    end if;
  end loop;

  if v_milestone is null then
    return null;
  end if;

  update public.users
  set max_glow_milestone_celebrated = greatest(max_glow_milestone_celebrated, v_milestone)
  where id = v_user;

  insert into public.journal_facts (user_id, circle_id, kind, body, local_date)
  values (
    v_user, null, 'glow_milestone',
    'hit ' || v_milestone || ' days glowing on ' || to_char(now(), 'FMMonth FMDD, YYYY'),
    (now() at time zone 'utc')::date
  );

  return v_milestone;
end;
$$;
revoke all on function public.check_glow_milestone() from anon, public;
grant execute on function public.check_glow_milestone() to authenticated;
