-- CV1 (23 July, Cat's ruling — OPTION B) — cover becomes a NEXT-DAY
-- RESCUE during the ember window, not a same-day pre-emption.
--
-- Before: the cover affordance appeared the moment a circle-mate had no
-- completion for the CURRENT day, at any hour — so a member could be
-- covered at 9am before they'd had any chance to show up, spending earned
-- shelter capacity they never needed. Ruling: a miss becomes real at the
-- end of the member's own local day; the NEXT day, while their glow is at
-- embers, a circle-mate can cover the MISSED day (their local yesterday).
--
-- This fits the glow model with no new decay concept. Because a cover
-- already writes a completions row keyed by local_date, and every glow
-- reader (get_glow_for_user and the readers that delegate to it) scans
-- completions BY DATE, a cover whose local_date is the missed day is
-- automatically read as 'held' for that day, counted against the missed
-- day's own month, and rekindles the chain — no reader change is needed.
--
-- Two changes here:
--   1. The cover INSERT policy now bounds local_date to the covered
--      member's OWN local yesterday (their stored timezone — the same
--      convention the ember window uses), which RETIRES same-day covering
--      at the database. A stale client that still posts today's date is
--      rejected.
--   2. A new reader, get_coverable_members, drives the affordance: a
--      member is coverable only while their glow state is 'embers' and
--      they have no completion in this circle for their local yesterday.
--
-- Cat's ruling (confirmed 23 July): YESTERDAY ONLY. Even though the ember
-- window spans 48h, the coverable target is always the member's local
-- yesterday, matching the "for yesterday" copy — one clean day, no multi-
-- day-gap partial-rescue ambiguity. The 48h window still governs the glow
-- STATE (whether they read as embers); the cover targets yesterday.
--
-- The timezone seam (OD1 job 20 / DEFERRED finding B) is NOT resolved
-- here — the covered member's own stored timezone is used, matching the
-- ember window; any new exposure of the seam is left OWED, not fixed.

-- ── 1. Retire same-day covering; bound the cover to the member's yesterday ──
-- The existing self-insert policy (kind='self', user_id = auth.uid()) is
-- untouched. Only the covered-insert policy changes: it gains the
-- yesterday bound. All the other rules (can't cover yourself, both are
-- members, one cover per member per date — now the missed date) carry over
-- verbatim. Capacity is deliberately NOT gated here: a cover past capacity
-- still writes its row and posts its warm moment; the glow math alone
-- decides whether the flame holds (spec §1, "the gift never visibly
-- fails").

drop policy "a member can cover another member's day" on public.completions;

create policy "a member can cover another member's missed day"
  on public.completions
  for insert
  with check (
    kind = 'covered'
    and covered_by = auth.uid()
    and user_id <> auth.uid()
    and is_member_of_circle(circle_id)
    and exists (
      select 1 from public.memberships m
      where m.circle_id = completions.circle_id and m.user_id = completions.user_id
    )
    -- CV1: the covered day must be the covered member's OWN local
    -- yesterday. now() is the transaction clock; the covered member's
    -- stored timezone (readable here because covering requires a shared
    -- circle — the same access the who's-here member list uses) turns it
    -- into their local calendar day. Same-day (their today) and any older
    -- day are both rejected.
    and completions.local_date = (
      (now() at time zone coalesce(
        (select u.timezone from public.users u where u.id = completions.user_id),
        'UTC'
      ))::date - 1
    )
    -- One cover per member per missed day (a second attempt finds the row
    -- and is rejected the same warm way).
    and not exists (
      select 1 from public.completions c2
      where c2.circle_id = completions.circle_id
        and c2.user_id = completions.user_id
        and c2.local_date = completions.local_date
    )
  );

-- ── 2. The affordance reader: who can be covered for yesterday right now ──
-- For each OTHER member of the circle (away members excluded — their glow
-- is held by their pause, spec §9, so they are not slipping), a member is
-- coverable iff their personal glow state is 'embers' (they missed a
-- recent day uncovered and are inside the 48h window) AND they have no
-- completion in THIS circle for their local yesterday (the day a cover
-- here would rescue). Returns their yesterday so the client can post the
-- cover against the right date without doing timezone math itself.
--
-- SECURITY DEFINER + search_path pinned; explicit revoke then grant
-- (S1/G5 posture — never rely on the default ACL). A non-member forging
-- the call gets an empty result, never an error that confirms the circle.

create function public.get_coverable_members(p_circle_id uuid)
returns table(user_id uuid, missed_local_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_member record;
  v_state text;
  v_yesterday date;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.circle_id = p_circle_id and m.user_id = v_caller
  ) then
    return;
  end if;

  for v_member in
    select m.user_id as member_id, coalesce(u.timezone, 'UTC') as tz
    from public.memberships m
    join public.users u on u.id = m.user_id
    where m.circle_id = p_circle_id
      and m.user_id <> v_caller
      and u.away_since is null
  loop
    v_yesterday := (now() at time zone v_member.tz)::date - 1;

    -- already done or already covered for this circle's yesterday → nothing
    -- to rescue here
    if exists (
      select 1 from public.completions c
      where c.circle_id = p_circle_id
        and c.user_id = v_member.member_id
        and c.local_date = v_yesterday
    ) then
      continue;
    end if;

    select g.state into v_state from public.get_glow_for_user(v_member.member_id) g;
    if v_state = 'embers' then
      user_id := v_member.member_id;
      missed_local_date := v_yesterday;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.get_coverable_members(uuid) from public, anon;
grant execute on function public.get_coverable_members(uuid) to authenticated, service_role;
