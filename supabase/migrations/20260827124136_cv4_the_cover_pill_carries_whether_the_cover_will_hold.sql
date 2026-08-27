-- CV4 job 0/2 (27 Aug) — the cover pill's own read carries whether the
-- cover it offers will actually hold the day.
--
-- CAT'S RULING (23 Aug), OPTION B: eligibility stays WIDE. Nothing here
-- narrows `ember_window_for` or `find_open_ember_windows`; a person past
-- their monthly cover capacity is still offered, still coverable, and the
-- gesture still lands. What changes is that the screen can now say, before
-- the tap commits, what this particular cover will be.
--
-- THE MECHANISM, MEASURED ON LIVE ROWS, NOT ASSUMED. `glow_day_states`
-- gates the shelter reset on `v_is_covered and v_holds_this_month <
-- v_capacity`. Past capacity a cover still writes, still fires
-- `completions_enqueue_covered_notice`, still renders as covered on the
-- circle screen — and holds nothing. Catherine S is the proof, from her
-- own history: covered rows on 2026-07-16 and 2026-07-22 both read back
-- `held_by = 'pebble'`, not `'cover'`, because 2026-07-10 had already
-- spent July's single hold. Two real covers, already silently doing what
-- this flag now announces.
--
-- WHY THE FLAG IS READ OFF THE LIVE RULE AND NOT RESTATED. Two copies of
-- one rule is the drift class, so neither half of the predicate is
-- re-derived here:
--
--   holds — counted off `glow_day_states`' OWN emitted rows. Every
--     `held_by = 'cover'` row is exactly one `v_holds_this_month + 1`
--     increment, and `to_char(d,'YYYY-MM')` is the same month reset the
--     function itself applies. Walking to `missed - 1` and filtering to
--     the missed day's month yields v_holds_this_month at precisely the
--     point in the walk where the new cover would be judged.
--
--   capacity — read from `get_glow_for_user`, which already exposes it as
--     `shelter_capacity`. No third statement of the threshold table.
--
-- WHY `missed - 1` AND NOT `missed`. The walk is forward-only and no day
-- depends on a later one, so inserting the cover at `missed` cannot change
-- any count before it. The days that matter are exactly the days strictly
-- before the missed one, in the missed day's own month — which is the
-- covered person's month, since `local_date` is already their local date.
-- A month boundary is therefore handled by construction: on the 1st, the
-- missed day belongs to the OUTGOING month and is counted there.
--
-- THE UNKNOWN IS SILENCE, NOT A GUESS (FF2's conservative direction). If
-- capacity cannot be read, the flag returns TRUE — the screen says nothing
-- rather than claiming a cover will be hollow when we do not know it. The
-- honesty line only ever appears on a measured negative.
--
-- ADDING A COLUMN IS ADDITIVE FOR POSTGREST, so a client bundle that has
-- not taken this OTA yet simply ignores the third field and behaves
-- exactly as it does today. Nothing about this read authorises a write:
-- the flag composes copy and nothing else.
--
-- A RETURN-TYPE CHANGE NEEDS DROP + CREATE (Postgres refuses `create or
-- replace` across a changed OUT signature), so the grants are restored
-- below. The `revoke ... from public, anon` is not decoration: G5's 7 July
-- finding is that this project's live default ACL still grants EXECUTE to
-- anon/PUBLIC automatically, so it must always be explicit. The ACL
-- restored here is the one read from pg_proc before the drop:
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

drop function if exists public.get_coverable_members(uuid);

create function public.get_coverable_members(p_circle_id uuid)
returns table(user_id uuid, missed_local_date date, cover_will_hold boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_member record;
  v_window record;
  v_capacity int;
  v_holds int;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  -- A non-member forging the call gets an empty result, never an error
  -- that confirms the circle exists.
  if not exists (
    select 1 from public.memberships m
    where m.circle_id = p_circle_id and m.user_id = v_caller
  ) then
    return;
  end if;

  for v_member in
    select m.user_id as member_id
    from public.memberships m
    where m.circle_id = p_circle_id
      and m.user_id <> v_caller
  loop
    select w.missed_local_date, w.spell_day into v_window
    from public.ember_window_for(v_member.member_id, p_circle_id) w;

    if found then
      -- The live capacity, read rather than restated.
      select g.shelter_capacity into v_capacity
      from public.get_glow_for_user(v_member.member_id) g;

      -- v_holds_this_month at the missed day, counted off glow_day_states'
      -- own rows: one row per increment, same month key, same walk.
      select count(*) into v_holds
      from public.glow_day_states(v_member.member_id, v_window.missed_local_date - 1) s
      where s.state = 'held'
        and s.held_by = 'cover'
        and to_char(s.d, 'YYYY-MM') = to_char(v_window.missed_local_date, 'YYYY-MM');

      user_id := v_member.member_id;
      missed_local_date := v_window.missed_local_date;
      -- Unknown capacity means silence, never a claim.
      cover_will_hold := v_capacity is null or coalesce(v_holds, 0) < v_capacity;
      return next;
    end if;
  end loop;
end;
$function$;

revoke all on function public.get_coverable_members(uuid) from public, anon;
grant execute on function public.get_coverable_members(uuid) to authenticated, service_role;
