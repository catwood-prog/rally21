-- CV2 (18 Aug) — the ember ask becomes two moments, spell 2 and spell 5.
--
-- WHAT CHANGES, IN ONE SENTENCE: eligibility widens to every day a cover
-- can still work, and the ASK's timing becomes a policy sitting on top of
-- it rather than a second definition beside it.
--
-- ══════════════════════════════════════════════════════════════════
-- WHY THIS IS NOT THE SECTION THAT WAS QUEUED
-- ══════════════════════════════════════════════════════════════════
--
-- CV2 was queued to pick a closing edge between spells 3-3, 3-4 and 3-5.
-- Its job 1 measured that and found two things that made all three the
-- wrong question. Both are recorded here because they are the reasons
-- for the values below, and a future session must not re-derive them.
--
-- CORRECTION 1 — A COVER IS A SAVE, and the original premise had it
-- backwards. "A cover is a gesture, not a save, because by the time
-- anyone taps it the day is already pebble-held" reads ember_window_for
-- and stops. Tracing it through glow_day_states' gap loop reverses the
-- conclusion: the cover branch runs
--
--     if v_is_covered and v_holds_this_month < v_capacity then
--       state := 'held';  held_by := 'cover';
--       v_holds_this_month := v_holds_this_month + 1;
--       v_gap_len := 0;                  -- <= THE SHELTER CLOCK RESTARTS
--
-- so the next miss spends a FRESH pebble and the cliff moves out. Proven
-- in live data, not only in source: Russ, 10 Aug held by pebble (nest 6
-- -> 5); 11 Aug held by COVER; 12 Aug earned; 13 Aug held by pebble with
-- a SECOND pebble spent, because the cover had started a new gap.
--
-- CORRECTION 2 — "DAY 3" WAS AMBIGUOUS BY EXACTLY ONE DAY. v_spell is
-- (their local yesterday) - (their last self check-in), so it counts
-- fully missed days AS OF YESTERDAY and every ask lands the morning
-- after the last day it counts. Cat's original sentence — "miss two days
-- in a row, then on the third day get a message" — is spell 2, which the
-- shipped 1-2 window already included. Job 1 had read it as spell 3.
--
-- CAT'S RULING (15 Aug) on the corrected picture: TWO ASKS, AT SPELL 2
-- AND SPELL 5. Not a range. Spell 2 is her sentence exactly, doing the
-- re-engagement job she described. Spell 5 is the last morning a cover
-- can still save the run, and correction 1 is what makes it worth
-- having. They are not adjacent, so consecutive-day repeats are
-- impossible.
--
-- ── THE VOLUME, MEASURED TWICE ──
--
-- Full history 3 Jul - 14 Aug, asks deduped on the shipped key's
-- (asked, missed, missed_local_date):
--
--   shipped 1-2   100 asks   (64 of them two-in-a-row)
--   3-3            17
--   3-4            30
--   3-5            40
--   RULED 2 + 5    42 asks, 5 askers, 5 people asked about
--
-- Per-spell volume decays steeply — 68 / 32 / 17 / 13 / 10 for spells
-- 1..5 — so SPELL 2 ALONE IS 32, already almost the whole of 3-4. Any
-- policy keeping Cat's original sentence starts at 32 before a second
-- moment is added; 42 is the floor for a two-moment policy, not an
-- overshoot. CAT RE-RULED 18 AUG: the section's own "stop if it exceeds
-- 39" gate is RETIRED as spell-3-era calibration, the policy stands at
-- the measured 42, and the 9 (asker, missed-person) pairs that get both
-- a spell-2 and a spell-5 ask about the same gap are ACCEPTED as the
-- design — re-engagement early, last chance late, three mornings apart.
--
-- Load stays mild: over 43 days the ask reaches one person at most twice
-- in a day (4 asker-days of 38), and never hits send-notifications'
-- 2-a-day cap on its own.
--
-- ══════════════════════════════════════════════════════════════════
-- THE STRUCTURAL DECISION, AND THE INVARIANT IT PRESERVES
-- ══════════════════════════════════════════════════════════════════
--
-- EM1 gave the mechanic ONE definition of eligibility and had both
-- callers inherit its bound. That produced a real property worth
-- keeping: the notification can never offer a rescue the circle screen
-- would refuse. IDENTICAL BOUNDS WERE ONLY HOW IT WAS ACHIEVED — the
-- property itself is a SUBSET relation, and it survives the split below
-- because find_open_ember_windows filters ember_window_for's rows rather
-- than re-deriving them.
--
-- THE INVARIANT, stated so a future reader can check it: every
-- (member, day) the ASK fires on is also a (member, day) the CIRCLE
-- SCREEN offers a cover for. {2,5} is a strict subset of {1,2,3,4,5}.
-- Pinned by a test in supabase/ember-ask.integration.test.ts rather than
-- asserted in prose.
--
-- ── WHAT (a) BUYS ON THE SCREEN ──
--
-- The pill becomes CONTINUOUS instead of appearing, vanishing on the
-- 3rd morning and never returning. Refusing a friend who opens the
-- circle on the 4th morning was arbitrary the moment correction 1
-- established that a cover on that morning still resets the gap.
--
-- ── WHAT (a) BUYS AT SEND TIME ──
--
-- send-notifications' send-time recheck calls ember_window_for DIRECTLY
-- (never a hand-copy of its rules), so it inherits the widened bound. A
-- row held by quiet hours past the asked person's midnight now STAYS
-- VALID where it previously expired: the window it was composed against
-- is still open at spell 3, 4 or 5. The suppression reasons that matter
-- — already_covered, already_checked_in, away — are untouched and still
-- fire first.
--
-- ── NAMED CHECK, REPORT ONLY (Cat's ruling, 16 Aug) ──
--
-- DOES ELIGIBILITY CONSULT REMAINING MONTHLY CAPACITY? IT DOES NOT, and
-- it does not start doing so here. ember_window_for reads users,
-- completions and nothing else — it never calls glow_day_states, never
-- computes v_capacity, never counts v_holds_this_month. CONSEQUENCE,
-- SAID PLAINLY: for a member whose monthly cover capacity is already
-- spent, a spell-5 ask invites a cover that will NOT reset the gap —
-- glow_day_states requires `v_holds_this_month < v_capacity` before it
-- will hold the day, and most people have capacity 1. The friend
-- believes they rescued someone; the gap continues. The capacity rule is
-- Cat's and does not change here. It is why job 4's spell-5 copy is
-- written in the hold-their-place register and deliberately promises no
-- save.

-- ── 1. (a) ELIGIBILITY WIDENS TO THE FULL SHELTER WINDOW ──
-- Identical signature, identical result columns; get_coverable_members
-- and the send-time recheck are both untouched callers and inherit this.
-- The ONLY line that changes is the bound, and it changes from Cat's
-- 5 Aug cadence (which is now a POLICY, see 2) to the shelter window
-- itself (which is a FACT about when a cover works).
create or replace function public.ember_window_for(p_user uuid, p_circle_id uuid)
returns table(missed_local_date date, spell_day int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_away timestamptz;
  v_yesterday date;
  v_last_self date;
  v_spell int;
begin
  select coalesce(u.timezone, 'UTC'), u.away_since
    into v_tz, v_away
  from public.users u where u.id = p_user;
  if not found then
    return;
  end if;

  -- Away is a total pause (Rally21-Glow-Spec.md §9): their glow is held
  -- by the pause, so they are not slipping and there is nothing to
  -- rescue. Same exclusion get_coverable_members has always made.
  if v_away is not null then
    return;
  end if;

  v_yesterday := (now() at time zone coalesce(v_tz, 'UTC'))::date - 1;

  -- Already done, or already covered, for the day a cover here would
  -- rescue — in THIS circle, which is the one a cover would be written
  -- against.
  if exists (
    select 1 from public.completions c
    where c.circle_id = p_circle_id
      and c.user_id = p_user
      and c.local_date = v_yesterday
  ) then
    return;
  end if;

  select max(c.local_date) into v_last_self
  from public.completions c
  where c.user_id = p_user
    and c.kind = 'self'
    and c.local_date <= v_yesterday;

  -- Never checked in at all: there is no rally to rescue.
  if v_last_self is null then
    return;
  end if;

  v_spell := v_yesterday - v_last_self;

  -- CV2: THE FULL SHELTER WINDOW, 1..5. Every day a cover still resets
  -- the gap, and therefore every day the circle screen should offer one.
  --
  -- 5 IS glow_day_states' c_max_gap_sheltered AND IT IS NOT A COINCIDENCE
  -- — but the two counters are OFF BY ONE from each other and a future
  -- edit must not "align" them. v_gap_len counts TODAY INCLUSIVE; v_spell
  -- counts fully missed days AS OF YESTERDAY. For the same real gap
  -- v_gap_len is one HIGHER. glow_day_states shelters while
  -- `v_gap_pebble and v_gap_len <= 5` and cliffs at v_gap_len = 6, so the
  -- last morning a cover can land and still reset the clock is the
  -- morning v_spell reads 5. Adding or subtracting one here moves a real
  -- rescue off the edge of a cliff.
  --
  -- 0 still means they DID show up yesterday, just in another circle.
  if v_spell < 1 or v_spell > 5 then
    return;
  end if;

  missed_local_date := v_yesterday;
  spell_day := v_spell;
  return next;
end;
$$;

-- create or replace preserves the ACL, but the S1/G5/HD4 posture is
-- restated rather than assumed (HD4: the project's default ACL merges
-- authenticated=X onto functions regardless of what a migration grants).
-- Never granted to `authenticated`: this answers "who missed a day",
-- which no signed-in account may ask about an arbitrary user id.
revoke all on function public.ember_window_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ember_window_for(uuid, uuid) to service_role;

-- ── 2. (b) THE ASK'S TIMING, AS A POLICY ON TOP ──
-- The one change is the spell_day filter. Everything else — the circle
-- exclusions, the away rule, MOD1's two-way block rule — is EM1's,
-- unchanged, and deliberately re-stated verbatim rather than edited.
create or replace function public.find_open_ember_windows()
returns table(
  asked_user_id uuid,
  asked_user_timezone text,
  missed_user_id uuid,
  missed_user_name text,
  circle_id uuid,
  circle_name text,
  missed_local_date date,
  spell_day int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_circle record;
  v_member record;
  v_mate record;
  v_window record;
begin
  for v_circle in
    -- "not finished": a completed circle is warmly archived, read-only
    -- history (Rally21-Glow-Spec.md §8) and an inactive one has nobody
    -- left in it. Neither ever asks anyone for anything again.
    select c.id, c.name
    from public.circles c
    where c.is_active = true and c.completed_at is null
  loop
    for v_member in
      select m.user_id as member_id,
             coalesce(u.name, 'a circle-mate') as member_name
      from public.memberships m
      join public.users u on u.id = m.user_id
      where m.circle_id = v_circle.id
    loop
      select w.missed_local_date, w.spell_day into v_window
      from public.ember_window_for(v_member.member_id, v_circle.id) w;

      if not found then
        continue;
      end if;

      -- CV2 — CAT'S RULING, 15 Aug: TWO MOMENTS, NOT A RANGE.
      --
      -- spell 2 = the third morning, after two fully quiet days. Her
      --           original sentence, doing re-engagement.
      -- spell 5 = the last morning a cover can still hold the run.
      --
      -- THIS IS A FILTER ON ROWS THE ONE DEFINITION ALREADY RETURNED,
      -- never a second derivation — which is what keeps the ask a strict
      -- SUBSET of what the circle screen offers. If a future change wants
      -- a third moment, add the value here; do NOT widen it back into
      -- ember_window_for, which answers a different question ("can a
      -- cover help") and is read by the screen.
      if v_window.spell_day not in (2, 5) then
        continue;
      end if;

      for v_mate in
        select m2.user_id as mate_id, coalesce(u2.timezone, 'UTC') as tz
        from public.memberships m2
        join public.users u2 on u2.id = m2.user_id
        where m2.circle_id = v_circle.id
          and m2.user_id <> v_member.member_id
          -- An away member is never nudged about anything (RS2), so they
          -- are never asked to rescue anyone either.
          and u2.away_since is null
          -- MOD1's rule, both directions: a block stops the gesture
          -- either way round, quietly, exactly as it stops a wave.
          and not exists (
            select 1 from public.blocks b
            where (b.blocker_id = m2.user_id and b.blocked_id = v_member.member_id)
               or (b.blocker_id = v_member.member_id and b.blocked_id = m2.user_id)
          )
      loop
        asked_user_id := v_mate.mate_id;
        asked_user_timezone := v_mate.tz;
        missed_user_id := v_member.member_id;
        missed_user_name := v_member.member_name;
        circle_id := v_circle.id;
        circle_name := v_circle.name;
        missed_local_date := v_window.missed_local_date;
        spell_day := v_window.spell_day;
        return next;
      end loop;
    end loop;
  end loop;
end;
$$;

revoke all on function public.find_open_ember_windows() from public, anon, authenticated;
grant execute on function public.find_open_ember_windows() to service_role;

-- ── 3. RIDE-ALONG (CV2 job R1) — one dead uuid in app_caps ──
--
-- '149bac2f-6557-403b-bf05-f830d42fc2e4', commented
-- "catherine.harwood@korefusion.com (test)", exists in NEITHER auth.users
-- NOR public.users — measured 18 Aug, and again in this section. That
-- account was RE-MINTED: the live one at the same email is
-- '7255ec4a-60af-497b-90ce-8835b47cb2cc', created 4 Aug, named Clemmie,
-- and confirmed by Cat (15 Aug) as her own test account. So the entry was
-- not wrong about WHO should be raised, only about which row that is —
-- it has simply been granting 10 circles to nobody since 6 July.
--
-- THREE THINGS DELIBERATELY NOT DONE HERE, all ruled by Cat on 15 Aug:
--   * the default of 3 STAYS (she considered 5 and ruled against);
--   * catherine@amsadvisory.co.uk is NOT added — capped on purpose;
--   * max_members_per_circle STAYS 12.
--
-- The 8 Aug migration's two preserved things are preserved again: the
-- pinned search_path (S1), and HD4's deliberate `authenticated` grant —
-- app_caps() is a LIVE client RPC (lib/caps.ts), so a drop-and-recreate
-- without that grant takes the app away from every signed-in user.
--
-- STILL TRUE, FROM THE 8 AUG NOTE: three hardcoded uuids is roughly where
-- this stops being an override and starts wanting to be a column on
-- `users`. Not changed here — that is a product decision, and this is a
-- repoint, not a redesign.
create or replace function public.app_caps()
returns table(max_circles_per_user int, max_members_per_circle int)
language sql
stable
set search_path to 'public'
as $$
  select
    case
      when auth.uid() in (
        '75ec0d88-27de-4227-ab62-3d049b369960', -- catherine.f.harwood@gmail.com (Catherine S)
        '7255ec4a-60af-497b-90ce-8835b47cb2cc', -- catherine.harwood@korefusion.com (Clemmie — Cat's test account, RE-MINTED 4 Aug; replaces the dead 149bac2f… entry, CV2 R1)
        'decc56b0-a748-448c-a469-2b0ac6957163'  -- cathystewart2002@hotmail.com (Cathy S — main from 8 Aug)
      ) then 10
      else 3
    end,
    12;
$$;

revoke all on function public.app_caps() from public;
revoke all on function public.app_caps() from anon;
revoke all on function public.app_caps() from authenticated;
grant execute on function public.app_caps() to authenticated;
