-- PA3 (28 July) — PEBBLES: the freeze mechanic made visible and self-serve.
-- Source of truth: Rally21-Personal-Arc-Decision-Memo.md §5.2 (the economy)
-- and §5.3 (what the flame shows during a gap).
--
-- WHAT WAS TRUE BEFORE THIS MIGRATION. Shelter capacity already existed,
-- but it was invisible, friend-given only, and far too thin: a day was
-- sheltered only if a friend wrote a `covered` completion row for it, and
-- only 1/2/3/4 such days per calendar month were honoured (scaled by
-- best-ever run). Modelled against the real cohort, burn rates run 1.8 to
-- 7.5 gaps per 30 days, so 1-per-month under 21 days failed to protect
-- even the most consistent user. There was no pebble stock anywhere,
-- because there is NO glow table — glow is recomputed live from
-- `completions` on every read.
--
-- ── THE STORAGE DECISION, and why it is not a full ledger ──
--
-- The section recommends an append-only ledger (balance = sum of deltas)
-- and asks for a justification of whatever is chosen. What ships here is
-- a ledger for GIFTS ONLY (`pebble_gifts`), with regeneration and spending
-- DERIVED by the same forward simulation that already computes the glow.
--
-- The reason is this project's own most expensive lesson, twice over: PA4
-- wrote two false sentences onto real walls by trusting a number it did
-- not re-derive, and CY1 had to update two hand-mirrored copies of one
-- ladder. A materialised spend would be a SECOND source of truth for a
-- fact the glow engine already has to compute anyway — "was this day
-- sheltered?" — and the two can disagree the moment either side's rules
-- move. A gift cannot be derived (it is an event between two people, and
-- only the giver knows it happened), so it is stored. A spend is not new
-- information: it is implied by the gap, and deriving it means the nest
-- and the flame can never contradict each other.
--
-- Deriving also buys a refund for free. If a friend covers the day a
-- pebble was holding, the next re-derivation simply never spends that
-- pebble (covers are classified before pebbles below), so the stock comes
-- back with no ledger surgery and no reconciliation pass. Precisely: a
-- cover that removes the WHOLE gap returns the pebble, while a cover of
-- part of a longer gap moves the spend to the next still-missed day
-- rather than refunding it — the count of pebbles spent is unchanged,
-- only the day it comes out of the nest. Both are pinned in
-- supabase/pebbles.integration.test.ts, because the first is easy to
-- over-read as "any cover refunds".
--
-- Balance is a FOLD, not a sum, because the cap makes it path-dependent:
-- regeneration stops at 6 but a gift may push a nest over 6, so
-- start + regen + gifts - spends is simply the wrong arithmetic. That is
-- the other reason a delta-sum ledger would not have worked unmodified.
--
-- ── THE SIMULATION IS FACTORED OUT, and why that is in scope ──
--
-- `glow_qualifying_days`, `get_week_for_user` and `get_glow_for_user` each
-- carried their own hand-copied duplicate of the same ~40-line day
-- classifier. Job 2 requires the pebble to shelter a day identically in
-- all three (the nest, the week row and the flame must agree), so the
-- choice was to hand-copy the new rules a fourth, fifth and sixth time or
-- to factor the classifier into one function. Copying is the drift class
-- this project has already been bitten by, so all three now delegate to
-- `glow_day_states`. No reader's external contract is narrowed; each gains
-- columns.

-- ────────────────────────────────────────────────────────────────────
-- 1. THE GIFT LEDGER — the only stored pebble input
-- ────────────────────────────────────────────────────────────────────
-- Append-only by construction: no update or delete policy exists, so a
-- gift is a fact once written. `local_date` is the GIVER's local date and
-- is the day the gift lands in the recipient's simulation; `created_at`
-- is the moment, used only for the recipient's "someone sent you a
-- pebble" freshness gate (the same users.warmth_seen_at marker TN1
-- already gates covers against).

create table public.pebble_gifts (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.users(id) on delete cascade,
  to_user uuid not null references public.users(id) on delete cascade,
  -- The circle the gesture happened in — kept for context only; a pebble
  -- belongs to the PERSON, exactly as the glow does, so it is never
  -- scoped to a circle when the nest is counted. Nulled rather than
  -- deleted if the circle goes away, so the gift survives the place.
  circle_id uuid references public.circles(id) on delete set null,
  local_date date not null,
  created_at timestamptz not null default now(),
  constraint pebble_gifts_not_self check (from_user <> to_user)
);

create index pebble_gifts_to_user_date_idx on public.pebble_gifts (to_user, local_date);
create index pebble_gifts_from_user_date_idx on public.pebble_gifts (from_user, local_date);
-- One gift per giver → recipient per giver-local-day. Not in the memo,
-- but the same one-per-day discipline the cover mechanic already carries
-- (CV1's "one cover per member per missed day"): without it, a nest is
-- fillable to any depth in one sitting and the cap stops meaning
-- anything. Enforced as an index so a race cannot beat it.
create unique index pebble_gifts_one_per_pair_per_day_idx
  on public.pebble_gifts (from_user, to_user, local_date);

alter table public.pebble_gifts enable row level security;

-- A person can read gifts they sent or received, and nothing else. There
-- is deliberately NO insert policy: gifting goes through gift_pebble()
-- alone, which is where the balance check lives (a direct insert could
-- otherwise mint pebbles from an empty nest).
create policy "you can see pebbles you gave or were given"
  on public.pebble_gifts
  for select
  using (from_user = auth.uid() or to_user = auth.uid());

-- ────────────────────────────────────────────────────────────────────
-- 2. THE LONGEST RALLY SURVIVES THE RUN (memo §5.1)
-- ────────────────────────────────────────────────────────────────────
-- "Your own glow ends honestly... your longest rally is kept permanently
-- and lives in the journal as an additive fact." A new journal kind, and
-- a partial unique index so recording it is idempotent however many times
-- the person opens the app after the run ended.

alter table public.journal_facts
  drop constraint journal_facts_kind_check,
  add constraint journal_facts_kind_check
    check (kind in ('circle_completed', 'rally_marker', 'major_stop', 'glow_milestone', 'longest_rally'));

create unique index journal_facts_one_longest_rally_per_break_idx
  on public.journal_facts (user_id, local_date)
  where kind = 'longest_rally';

-- ────────────────────────────────────────────────────────────────────
-- 3. THE ONE SIMULATION
-- ────────────────────────────────────────────────────────────────────
-- One forward pass per user, oldest day first, maintaining the nest and
-- the run together. Every glow reader delegates here.
--
-- THE ECONOMY (memo §5.2, decided from cohort gap data — these are
-- decisions, not tuning knobs):
--   start 3 on joining · regain 1 every 3 days · cap 6
--   one pebble covers one gap of 1-5 days, whatever its length
--   a 6th consecutive missed day ends the run
--   away is free and uncapped and never touches the nest
--   a gift may push a nest OVER the cap
--
-- REGENERATION IS BY TIME, NOT BY PRACTICE (memo §5.2). Earn-by-practice
-- hands the most protection to the people needing it least, which is the
-- current system's flaw inverted. The tick is a clock: it advances every
-- day and grants on every third one, and a full nest simply misses that
-- grant rather than banking it — so a person sitting at the cap does not
-- accumulate an invisible queue that pays out the moment they spend.
--
-- DAY CLASSIFICATION ORDER, and why it is this order:
--   self > away > cover > pebble > unsheltered
-- Self first because a day you showed up for is never anything else. Away
-- before cover and pebble because the pause is free and must never burn
-- either. Cover before pebble because a friend's gift should spend itself
-- before your own reserve — which is also what makes a late cover refund
-- a pebble automatically on the next read.
create function public.glow_day_states(p_user uuid, p_through date)
returns table(
  d date,
  -- The week row's existing vocabulary, unchanged: 'earned' | 'held' | 'none'.
  state text,
  -- What did the holding, so the flame can show the pebble as the marker
  -- (memo §5.3): 'away' | 'cover' | 'pebble', null unless state = 'held'.
  held_by text,
  -- The nest at the END of this day.
  pebbles_after int,
  -- The live run at the END of this day.
  run_after int,
  -- Set only on a day that ENDED a run:
  --   'cliff'       — a pebble held the gap and the 6th day still arrived
  --   'unsheltered' — the nest was empty when the gap opened
  -- The distinction matters: a spent pebble WAS the grace, so a cliff goes
  -- straight to cold, while an empty nest still gets the ember window.
  break_kind text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_start_pebbles constant int := 3;
  c_regen_every_days constant int := 3;
  c_cap constant int := 6;
  c_max_gap_sheltered constant int := 5;

  v_tz text;
  v_away_since timestamptz;
  v_away_since_date date;
  v_account_start date;
  v_first_completion date;
  v_start date;
  v_cursor date;

  v_max_glow_ever int;
  v_capacity int;
  v_month_key text := null;
  v_holds_this_month int := 0;

  v_balance int := c_start_pebbles;
  v_regen_tick int := 0;
  v_run int := 0;
  v_gap_len int := 0;
  v_gap_pebble boolean := false;

  v_is_self boolean;
  v_is_covered boolean;
  v_is_away_row boolean;
  v_gifts_in int;
  v_gifts_out int;
begin
  if p_user is null then
    raise exception 'p_user is required';
  end if;

  select coalesce(timezone, 'UTC'), away_since, (created_at at time zone coalesce(timezone, 'UTC'))::date
    into v_tz, v_away_since, v_account_start
  from public.users where id = p_user;
  if v_tz is null then v_tz := 'UTC'; end if;
  v_away_since_date := case when v_away_since is not null
    then (v_away_since at time zone v_tz)::date else null end;

  select min(local_date) into v_first_completion
  from public.completions where user_id = p_user;

  -- The nest starts filling on JOINING (memo §5.2 — "so newcomers are
  -- protected immediately rather than least"), which is the account, not
  -- the first practice. least() keeps a backfilled completion older than
  -- the account row from starting the walk after its own data.
  v_start := least(
    coalesce(v_account_start, v_first_completion, p_through),
    coalesce(v_first_completion, v_account_start, p_through)
  );
  if v_start is null or v_start > p_through then
    return;
  end if;

  -- Cover capacity, carried over verbatim from the pre-PA3 readers so the
  -- monthly cover allowance keeps exactly the meaning it shipped with.
  -- Pebbles do NOT touch this — they are a separate, personal reserve.
  select coalesce(max(self_count), 0) into v_max_glow_ever
  from (
    select grp_key, count(*) filter (where is_self) as self_count
    from (
      select local_date, bool_or(kind = 'self') as is_self,
        local_date - (row_number() over (order by local_date))::int as grp_key
      from public.completions
      where user_id = p_user
      group by local_date
    ) g
    group by grp_key
  ) runs;

  v_capacity := case
    when v_max_glow_ever >= 100 then 4
    when v_max_glow_ever >= 50 then 3
    when v_max_glow_ever >= 21 then 2
    else 1
  end;

  v_cursor := v_start;
  while v_cursor <= p_through loop
    if to_char(v_cursor, 'YYYY-MM') is distinct from v_month_key then
      v_month_key := to_char(v_cursor, 'YYYY-MM');
      v_holds_this_month := 0;
    end if;

    -- Regeneration, by time. Never on the joining day itself (that is
    -- what the starting 3 is), and never above the cap.
    if v_cursor > v_start then
      v_regen_tick := v_regen_tick + 1;
      if v_regen_tick >= c_regen_every_days then
        v_regen_tick := 0;
        if v_balance < c_cap then
          v_balance := v_balance + 1;
        end if;
      end if;
    end if;

    -- Gifts settle on the giver's local date. A gift MAY push the
    -- recipient's nest over the cap (memo §5.2) — the cap governs
    -- regeneration, not generosity.
    select count(*) into v_gifts_in
    from public.pebble_gifts where to_user = p_user and local_date = v_cursor;
    select count(*) into v_gifts_out
    from public.pebble_gifts where from_user = p_user and local_date = v_cursor;
    v_balance := v_balance + v_gifts_in - v_gifts_out;
    if v_balance < 0 then v_balance := 0; end if;

    select exists(
      select 1 from public.completions
      where user_id = p_user and local_date = v_cursor and kind = 'self'
    ) into v_is_self;

    d := v_cursor;
    break_kind := null;

    if v_is_self then
      state := 'earned';
      held_by := null;
      v_run := v_run + 1;
      v_gap_len := 0;
      v_gap_pebble := false;
    else
      select exists(
        select 1 from public.completions
        where user_id = p_user and local_date = v_cursor and kind = 'away'
      ) into v_is_away_row;

      if v_is_away_row or (v_away_since_date is not null and v_cursor >= v_away_since_date) then
        -- Away is free and uncapped and never touches the nest (memo
        -- §5.2). It also does not extend a gap: the pause is not a miss.
        state := 'held';
        held_by := 'away';
        v_gap_len := 0;
        v_gap_pebble := false;
      else
        select exists(
          select 1 from public.completions
          where user_id = p_user and local_date = v_cursor and kind = 'covered'
        ) into v_is_covered;

        if v_is_covered and v_holds_this_month < v_capacity then
          state := 'held';
          held_by := 'cover';
          v_holds_this_month := v_holds_this_month + 1;
          v_gap_len := 0;
          v_gap_pebble := false;
        else
          -- A missed day. One pebble is committed when the gap OPENS and
          -- shelters the whole gap up to five days, whatever its length.
          v_gap_len := v_gap_len + 1;
          if v_gap_len = 1 then
            if v_balance >= 1 then
              v_balance := v_balance - 1;
              v_gap_pebble := true;
            else
              v_gap_pebble := false;
            end if;
          end if;

          if v_gap_pebble and v_gap_len <= c_max_gap_sheltered then
            state := 'held';
            held_by := 'pebble';
          else
            state := 'none';
            held_by := null;
            -- The run ends on the first day nothing could hold. Guarded on
            -- v_run so days 7, 8, 9 of the same gap do not each re-report
            -- a break that already happened.
            if v_run > 0 then
              break_kind := case when v_gap_pebble then 'cliff' else 'unsheltered' end;
            end if;
            v_run := 0;
          end if;
        end if;
      end if;
    end if;

    pebbles_after := v_balance;
    run_after := v_run;
    return next;

    v_cursor := v_cursor + 1;
  end loop;
end;
$$;

revoke all on function public.glow_day_states(uuid, date) from public, anon;
grant execute on function public.glow_day_states(uuid, date) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────
-- 4. THE READERS, all delegating to the one simulation
-- ────────────────────────────────────────────────────────────────────

-- glow_qualifying_days — unchanged contract (d, qualifies). A pebble-held
-- day now qualifies, exactly as a covered or away day already did: this
-- function measures CONTINUITY, never practice effort (memo §9), and the
-- rally count that measures effort reads kind='self' alone and is
-- untouched by anything here.
create or replace function public.glow_qualifying_days(p_user uuid, p_through date)
returns table(d date, qualifies boolean)
language sql
security definer
set search_path = public
as $$
  select s.d, s.state <> 'none' from public.glow_day_states(p_user, p_through) s;
$$;

-- get_week_for_user — gains held_by so the week row can show the pebble
-- as the marker (memo §5.3). state keeps its three shipped values.
drop function if exists public.get_my_week();
drop function if exists public.get_week_for_user(uuid);

create function public.get_week_for_user(p_user uuid)
returns table(day_date date, state text, held_by text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
begin
  if p_user is null then
    raise exception 'p_user is required';
  end if;
  select coalesce(timezone, 'UTC') into v_tz from public.users where id = p_user;
  if v_tz is null then v_tz := 'UTC'; end if;
  v_today := (now() at time zone v_tz)::date;

  return query
  select s.d, s.state, s.held_by
  from public.glow_day_states(p_user, v_today) s
  where s.d >= v_today - 6;
end;
$$;

-- service_role only, matching the posture this function shipped with:
-- get_my_week() is the authenticated entry point and passes auth.uid()
-- itself, so no caller can name another user here.
revoke all on function public.get_week_for_user(uuid) from public, anon;
grant execute on function public.get_week_for_user(uuid) to service_role;

create function public.get_my_week()
returns table(day_date date, state text, held_by text)
language sql
security definer
set search_path = public
as $$
  select * from public.get_week_for_user(auth.uid());
$$;

revoke all on function public.get_my_week() from public, anon;
grant execute on function public.get_my_week() to authenticated, service_role;

-- get_glow_for_user — keeps every column it shipped with and gains four.
--
-- WHAT DELIBERATELY DID NOT CHANGE HERE, and why. `state` keeps its
-- shipped meaning ('glowing' | 'embers' | 'cold'), because three live
-- server mechanics branch on it — CV1's get_coverable_members, the ember
-- nudge in compose-nudges, and that nudge's staleness guard in
-- send-notifications. Job 4's narrowing of embers is applied to THE FLAME,
-- which is what §5.3 is about; repointing this column would have silently
-- changed when two shipped notifications fire, which is outside PA3's
-- scope and is reported instead.
--
-- Multi-day ember decay nonetheless disappears from the normal path on
-- its own: a gap is now pebble-held, so the run never breaks and the state
-- never leaves 'glowing'. Embers survives only as the grace for an EMPTY
-- nest, and a cliff (a pebble held the gap and the sixth day still came)
-- goes straight to cold, because the pebble already was the grace.
drop function if exists public.get_my_glow();
drop function if exists public.get_glow_for_user(uuid);

create function public.get_glow_for_user(p_user uuid)
returns table(
  glow int,
  state text,
  ember_deadline timestamptz,
  held_today boolean,
  shelter_used int,
  shelter_capacity int,
  missed_local_date date,
  -- PA3 additions
  pebbles int,
  held_by_today text,
  longest_rally int,
  ended_at_cliff boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
  v_row record;
  -- Today's row is held as scalars, never as a RECORD: a record variable
  -- that never gets assigned (a user whose simulation returns no rows at
  -- all) raises "record is not assigned yet" on the first field read,
  -- where a scalar simply stays null.
  v_today_seen boolean := false;
  v_today_state text := null;
  v_today_held_by text := null;
  v_today_run int := 0;
  v_today_pebbles int := null;
  v_run_before_break int := 0;
  v_last_break date := null;
  v_last_break_kind text := null;
  v_prev_run int := 0;
  v_away_holds_since_break int := 0;
  v_longest int := 0;
  v_pebbles int := 3;
  v_holds_used int := 0;
  v_capacity int := 1;
  v_month_key text := null;
begin
  if p_user is null then
    raise exception 'p_user is required';
  end if;

  select coalesce(timezone, 'UTC') into v_tz from public.users where id = p_user;
  if v_tz is null then v_tz := 'UTC'; end if;
  v_today := (now() at time zone v_tz)::date;

  for v_row in
    select * from public.glow_day_states(p_user, v_today) order by d
  loop
    if v_row.run_after > v_longest then
      v_longest := v_row.run_after;
    end if;

    if v_row.break_kind is not null then
      v_last_break := v_row.d;
      v_last_break_kind := v_row.break_kind;
      v_run_before_break := v_prev_run;
      v_away_holds_since_break := 0;
    elsif v_last_break is not null and v_row.state = 'held'
          and v_row.held_by = 'away' and v_row.run_after = 0 then
      -- An away pause after a break extends the ember window rather than
      -- burning it, exactly as the pre-PA3 engine did.
      v_away_holds_since_break := v_away_holds_since_break + 1;
    end if;

    v_prev_run := v_row.run_after;

    if v_row.d = v_today then
      v_today_seen := true;
      v_today_state := v_row.state;
      v_today_held_by := v_row.held_by;
      v_today_run := v_row.run_after;
      v_today_pebbles := v_row.pebbles_after;
    end if;

    -- Cover allowance actually consumed in the CURRENT calendar month,
    -- for the shelter_used/shelter_capacity contract.
    if to_char(v_row.d, 'YYYY-MM') is distinct from v_month_key then
      v_month_key := to_char(v_row.d, 'YYYY-MM');
      v_holds_used := 0;
    end if;
    if v_row.state = 'held' and v_row.held_by = 'cover' then
      v_holds_used := v_holds_used + 1;
    end if;

    v_pebbles := v_row.pebbles_after;
  end loop;

  select case
    when coalesce(max(self_count), 0) >= 100 then 4
    when coalesce(max(self_count), 0) >= 50 then 3
    when coalesce(max(self_count), 0) >= 21 then 2
    else 1
  end into v_capacity
  from (
    select grp_key, count(*) filter (where is_self) as self_count
    from (
      select local_date, bool_or(kind = 'self') as is_self,
        local_date - (row_number() over (order by local_date))::int as grp_key
      from public.completions
      where user_id = p_user
      group by local_date
    ) g
    group by grp_key
  ) runs;

  glow := case when v_today_seen then v_today_run else 0 end;
  pebbles := coalesce(v_today_pebbles, v_pebbles);
  held_today := coalesce(v_today_state, 'none') = 'held';
  held_by_today := v_today_held_by;
  longest_rally := v_longest;
  shelter_used := v_holds_used;
  shelter_capacity := v_capacity;
  ember_deadline := null;
  missed_local_date := null;
  ended_at_cliff := false;

  if (v_today_seen and v_today_run > 0) or v_last_break is null then
    -- The run is alive (today earned or held, or still carrying from
    -- yesterday). Nothing is at risk that a pebble has not already held.
    state := 'glowing';
  elsif v_last_break_kind = 'cliff' then
    -- Memo §5.1/§5.3 — a pebble held this gap and the sixth day still
    -- arrived. The run ended honestly, the flame goes out, and the
    -- longest rally stands in its place. No ember window: the grace was
    -- already spent as a pebble.
    state := 'cold';
    ended_at_cliff := true;
    glow := 0;
  else
    -- An unsheltered miss from an empty nest keeps the shipped 48h grace.
    ember_deadline := ((v_last_break + 3 + v_away_holds_since_break)::timestamp at time zone v_tz);
    missed_local_date := v_last_break;
    if now() < ember_deadline then
      state := 'embers';
      glow := v_run_before_break;
    else
      state := 'cold';
      glow := 0;
      ember_deadline := null;
      missed_local_date := null;
    end if;
  end if;

  return next;
end;
$$;

revoke all on function public.get_glow_for_user(uuid) from public, anon;
grant execute on function public.get_glow_for_user(uuid) to service_role;

create function public.get_my_glow()
returns table(
  glow int,
  state text,
  ember_deadline timestamptz,
  held_today boolean,
  shelter_used int,
  shelter_capacity int,
  pebbles int,
  held_by_today text,
  longest_rally int,
  ended_at_cliff boolean
)
language sql
security definer
set search_path = public
as $$
  select g.glow, g.state, g.ember_deadline, g.held_today, g.shelter_used,
         g.shelter_capacity, g.pebbles, g.held_by_today, g.longest_rally,
         g.ended_at_cliff
  from public.get_glow_for_user(auth.uid()) g;
$$;

revoke all on function public.get_my_glow() from public, anon;
grant execute on function public.get_my_glow() to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────
-- 5. GIFTING (job 3)
-- ────────────────────────────────────────────────────────────────────
-- Friends add pebbles to each other's nests. The giver spends one of
-- their own; the recipient's nest may go OVER the cap (memo §5.2).
--
-- The balance check is why there is no INSERT policy on pebble_gifts: a
-- direct insert would mint a pebble from an empty nest. Everything goes
-- through here.
--
-- MOD1's block list is honoured in both directions, matching
-- send_friend_nudge — a gesture between people is never delivered across
-- a block.
create function public.gift_pebble(p_circle_id uuid, p_recipient uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_tz text;
  v_local_date date;
  v_balance int;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if p_recipient = v_caller then
    raise exception 'you cannot gift a pebble to yourself';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.circle_id = p_circle_id and m.user_id = v_caller
  ) then
    raise exception 'not a member of this circle';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.circle_id = p_circle_id and m.user_id = p_recipient
  ) then
    raise exception 'they are not a member of this circle';
  end if;

  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_caller and b.blocked_id = p_recipient)
       or (b.blocker_id = p_recipient and b.blocked_id = v_caller)
  ) then
    raise exception 'not available';
  end if;

  select coalesce(timezone, 'UTC') into v_tz from public.users where id = v_caller;
  v_local_date := (now() at time zone coalesce(v_tz, 'UTC'))::date;

  -- Re-derive the giver's nest server-side rather than trusting anything
  -- the client believes about it (PA4's class lesson, 28 July).
  select g.pebbles into v_balance from public.get_glow_for_user(v_caller) g;
  if coalesce(v_balance, 0) < 1 then
    raise exception 'your nest is empty';
  end if;

  insert into public.pebble_gifts (from_user, to_user, circle_id, local_date)
  values (v_caller, p_recipient, p_circle_id, v_local_date);

  return v_balance - 1;
exception
  when unique_violation then
    raise exception 'you already sent them a pebble today';
end;
$$;

revoke all on function public.gift_pebble(uuid, uuid) from public, anon;
grant execute on function public.gift_pebble(uuid, uuid) to authenticated, service_role;

-- Who in this circle could use a pebble right now — the moment the
-- gesture happens in. A member qualifies when their nest is empty or
-- their run is at risk, and away members are excluded (their pause
-- already holds them, spec §9). Derived server-side; no arbitrary-uuid
-- read exists to make, and a non-member gets an empty result.
create function public.get_pebble_candidates(p_circle_id uuid)
returns table(user_id uuid, pebbles int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_member record;
  v_glow record;
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
    select m.user_id as member_id
    from public.memberships m
    join public.users u on u.id = m.user_id
    where m.circle_id = p_circle_id
      and m.user_id <> v_caller
      and u.away_since is null
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = v_caller and b.blocked_id = m.user_id)
           or (b.blocker_id = m.user_id and b.blocked_id = v_caller)
      )
  loop
    select * into v_glow from public.get_glow_for_user(v_member.member_id);
    if coalesce(v_glow.pebbles, 0) <= 1 or v_glow.state = 'embers' then
      user_id := v_member.member_id;
      pebbles := coalesce(v_glow.pebbles, 0);
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.get_pebble_candidates(uuid) from public, anon;
grant execute on function public.get_pebble_candidates(uuid) to authenticated, service_role;

-- Gifts the caller has been given that they have not been told about yet.
-- Gated against users.warmth_seen_at, the SAME marker TN1 already uses for
-- waves, hearts and covers, so the notification spot keeps one freshness
-- rule rather than one per event type.
create function public.get_my_fresh_pebble_gifts()
returns table(sender_name text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select coalesce(u.name, 'someone in your circle'), g.created_at
  from public.pebble_gifts g
  join public.users u on u.id = g.from_user
  where g.to_user = auth.uid()
    and g.created_at > coalesce(
      (select w.warmth_seen_at from public.users w where w.id = auth.uid()),
      '-infinity'::timestamptz
    )
  order by g.created_at desc;
$$;

revoke all on function public.get_my_fresh_pebble_gifts() from public, anon;
grant execute on function public.get_my_fresh_pebble_gifts() to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────
-- 6. THE RUN THAT ENDED KEEPS ITS RECORD (job 2, memo §5.1)
-- ────────────────────────────────────────────────────────────────────
-- Detect-and-write, following check_glow_milestone's shipped pattern: the
-- glow READS stay side-effect-free, and the durable fact is written by an
-- explicit call the client makes when it loads Today. Idempotent via the
-- partial unique index, so however many times it is called after a cliff
-- there is exactly one journal fact for it.
--
-- Returns the longest rally when this call recorded one, null otherwise —
-- so the client shows the sentence on the visit that earned it and never
-- again.
create function public.record_my_rally_cliff()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tz text;
  v_today date;
  v_break date := null;
  v_longest int := 0;
  v_row record;
  v_prev_run int := 0;
  v_inserted int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(timezone, 'UTC') into v_tz from public.users where id = v_user;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;

  for v_row in select * from public.glow_day_states(v_user, v_today) order by d loop
    if v_row.run_after > v_longest then v_longest := v_row.run_after; end if;
    if v_row.break_kind is not null then
      v_break := v_row.d;
    end if;
    v_prev_run := v_row.run_after;
  end loop;

  if v_break is null or v_longest < 1 then
    return null;
  end if;

  insert into public.journal_facts (user_id, kind, body, local_date)
  values (
    v_user,
    'longest_rally',
    'your longest rally: ' || v_longest || ' day' || case when v_longest = 1 then '' else 's' end,
    v_break
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return null;
  end if;
  return v_longest;
end;
$$;

revoke all on function public.record_my_rally_cliff() from public, anon;
grant execute on function public.record_my_rally_cliff() to authenticated, service_role;
