-- SC3 (18 July) — the day-21 mini-Wrapped's once-per-milestone offer
-- marker (Rally21-Share-Cards-Spec.md §4.5). Mirrors R1's
-- last_celebrated_day exactly: a monotonic per-membership high-water
-- mark, bumped when the offer is SHOWN inside the ceremony, so a
-- declined offer never nags and never reappears for that milestone —
-- and the same machinery serves the 50/100/365 major stops later (a
-- later stop's day is simply a higher number).

alter table public.memberships
  add column last_wrapped_offer_day int not null default 0;

-- Monotonic bump on the caller's OWN membership row only. SECURITY
-- DEFINER (memberships has no self-serve UPDATE policy — same reason
-- mark_celebration_seen is an RPC), S1 hygiene throughout.
create or replace function public.mark_wrapped_offered(
  p_circle_id uuid,
  p_day int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.memberships
  set last_wrapped_offer_day = greatest(last_wrapped_offer_day, p_day)
  where circle_id = p_circle_id and user_id = auth.uid();
end;
$$;

revoke all on function public.mark_wrapped_offered(uuid, int) from public;
revoke all on function public.mark_wrapped_offered(uuid, int) from anon;
grant execute on function public.mark_wrapped_offered(uuid, int) to authenticated;
