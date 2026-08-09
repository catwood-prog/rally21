-- EM1 (9 Aug) — the ember ask, and the covered notice.
--
-- Two outbound halves of one mechanic that already exists on the
-- receiving side. The ASK goes to a circle-mate while a rescue window is
-- open ("{name}'s been quiet"), deep-linking into CV1's existing cover
-- flow. The COVERED NOTICE goes to the person the moment a cover lands.
-- Nothing here decides HOW either is delivered — send-notifications
-- still owns that, including the 2-a-day cap and the quiet-hours clamp,
-- which both halves ride inside rather than beside (PN1's rule: push is
-- a channel of the one pipeline, never a second system).
--
-- ══════════════════════════════════════════════════════════════════
-- THE WINDOW MOVED, AND THAT IS THE POINT OF THIS MIGRATION
-- ══════════════════════════════════════════════════════════════════
--
-- CV1 (23 July) defined the coverable moment as "their glow state is
-- 'embers' AND this circle's yesterday is still open". At the time those
-- two clauses meant the same thing, because ANY uncovered missed day
-- broke the run and opened a 48h ember window: "at embers" WAS "missed
-- yesterday".
--
-- PA3 (28 July) changed what a missed day does. `glow_day_states` now
-- spends a pebble from the person's nest on the first day of a gap and
-- marks up to five days 'held', so the run never breaks and the state
-- never leaves 'glowing'. PA3's own migration says so and reported it
-- rather than acting on it: "Embers survives only as the grace for an
-- EMPTY nest... repointing this column would have silently changed when
-- two shipped notifications fire, which is outside PA3's scope."
--
-- So CV1's affordance narrowed as a SIDE EFFECT that nobody ruled on.
-- Measured 9 Aug in a rolled-back transaction against the live database:
--
--   28-day run, missed 2 days, FULL nest  -> state 'glowing',
--                                            get_coverable_members = []
--   same, EMPTY nest                      -> state 'embers', offered
--   21-day glow then a 6-day spell        -> pebble-held days 1-5,
--     (the occasion that prompted EM1)       'cliff' on day 6 -> 'cold',
--                                            never coverable on ANY day
--   live cohort that day                  -> 5 glowing, 2 cold, 0 embers
--
-- CAT'S RULING (9 Aug, in session): widen BOTH readers to one shared
-- definition, so the notification and the circle screen can never
-- disagree about whether a rescue is available. That definition is
-- `ember_window_for` below, and it is the ONLY place it exists —
-- get_coverable_members and find_open_ember_windows are both thin
-- callers of it now.
--
-- Nothing about the WRITE changes: CV1's INSERT policy already bounds a
-- cover to the covered member's own local yesterday and never consulted
-- the glow state, so the widened affordance cannot offer anything the
-- database would refuse.
--
-- A cover during a pebble-sheltered gap is a real rescue, not a no-op:
-- glow_day_states classifies covers BEFORE pebbles, so the cover holds
-- the day, the pebble is never spent, and the gap counter resets — which
-- is the clock that ends in a 'cliff' on day 6.
--
-- ── CAT'S CADENCE RULING (5 Aug), expressed as spell_day ──
--
-- "The ask fires on the FIRST and SECOND day of a missed spell — two
-- days in a row — and NEVER after." A spell is measured in the member's
-- own days WITHOUT A SELF CHECK-IN: spell_day = (their local yesterday)
-- minus (their most recent kind='self' completion on or before it). The
-- day-1 ask targets the first missed day, the day-2 ask targets the
-- second, and day 3 returns nothing at all.
--
-- Counted on SELF completions only, deliberately: a covered day is still
-- a day the person did not show up, which is what keeps the two asks
-- two even in the case where the ember state would otherwise slide
-- forward (day 1 covered, day 2 missed re-breaks the run and re-opens a
-- fresh 48h window that would have carried a third ask).
--
-- WHAT A DAY-2 COVER SAVES, measured the same day, because "two days in
-- a row" is only worth building if the second day buys something:
--   day 1 uncovered              -> NOTHING. The rally broke at day 1 and
--                                   only a day-1 cover restores it.
--   day 1 covered, best run >=21 -> THE WHOLE RALLY. On returning today
--                                   they read day 1 without it, day 29
--                                   with it.
--   day 1 covered, best run <21  -> NOTHING. Shelter capacity is 1 per
--                                   month below 21 days and the day-1
--                                   cover already spent it, so the second
--                                   cover writes its row and its warm
--                                   moment but holds no day.

-- ── 1. Two new outbox kinds ──
alter table public.notification_outbox
  drop constraint notification_outbox_kind_check,
  add constraint notification_outbox_kind_check
    check (kind in (
      'nudge_daily', 'social_digest', 'friend_nudge', 'ember_nudge',
      'rest_rejoin', 'ember_ask', 'covered_notice'
    ));

-- ── 2. THE ONE DEFINITION ──
-- Is there an open rescue window for this member, in this circle, right
-- now? Zero rows means no; one row carries the day a cover would rescue
-- and which day of the spell it is.
--
-- Scoped to the WINDOW (a person and a day) and nothing else. Who may be
-- ASKED about it — circle still running, mates not away, no block either
-- way — is a separate question and lives in find_open_ember_windows,
-- because those are facts about the askers rather than about the window.
--
-- The two in-database callers are SECURITY DEFINER functions owned by
-- the same role, so they reach it as owner without any grant. It is
-- granted to service_role for one reason: send-notifications re-checks
-- the window at SEND time (a row can sit behind quiet hours or the daily
-- cap while the window closes), and that recheck has to ask THIS
-- function rather than a hand-copy of its rules — a second definition
-- that drifts is precisely what this migration exists to remove.
-- Never granted to `authenticated`: it answers "who missed a day", which
-- no signed-in account may ask about an arbitrary user id.
create function public.ember_window_for(p_user uuid, p_circle_id uuid)
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
  -- 0 means they DID show up yesterday, just in another circle. 3+ is
  -- past Cat's ruling: the window closes for good and the rescue yields
  -- to the resting/away path.
  if v_spell < 1 or v_spell > 2 then
    return;
  end if;

  missed_local_date := v_yesterday;
  spell_day := v_spell;
  return next;
end;
$$;

revoke all on function public.ember_window_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ember_window_for(uuid, uuid) to service_role;

-- ── 3. CV1's affordance, repointed at the shared definition ──
-- Identical signature and identical result columns — lib/circle.ts's
-- getCoverableMembers reads (user_id, missed_local_date) and is
-- untouched. The ONLY change is that the ember-state test is gone, which
-- is Cat's 9 Aug ruling above.
create or replace function public.get_coverable_members(p_circle_id uuid)
returns table(user_id uuid, missed_local_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_member record;
  v_window record;
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
      user_id := v_member.member_id;
      missed_local_date := v_window.missed_local_date;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.get_coverable_members(uuid) from public, anon;
grant execute on function public.get_coverable_members(uuid) to authenticated, service_role;

-- ── 4. The window finder: who should be ASKED, about which window ──
-- Returns one row per (circle-mate to ask, open window), already
-- expanded — compose-nudges only enqueues. service_role only: the cron
-- runs with no JWT, and nothing signed-in has any business enumerating
-- who across the whole cohort has missed a day.
create function public.find_open_ember_windows()
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

-- S1/G5/HD4 posture: pin the search_path, then revoke from public, anon
-- AND authenticated before the real grant. `authenticated` is named
-- explicitly because the project's default ACL merges `authenticated=X`
-- onto every newly created function whether or not its migration grants
-- it (HD4, 5 Aug) — omitting it here would hand every signed-in account
-- a whole-cohort read of who has missed a day.
revoke all on function public.find_open_ember_windows() from public, anon, authenticated;
grant execute on function public.find_open_ember_windows() to service_role;

-- ── 5. The covered notice, enqueued the moment a cover lands ──
-- A cover is a plain RLS-governed INSERT (CLAUDE.md: all four cover
-- rules live in RLS, not in application code), so there is no RPC seam
-- to hang this on and a trigger is the only place that sees every cover
-- however it arrives. It enqueues ONLY — send-notifications still
-- decides whether and how, so the cap and quiet hours apply unchanged.
--
-- Security spec S1 (F4): nothing client-composed crosses this boundary.
-- The payload carries looked-up NAMES and ids; send-notifications
-- composes the sentence from its own fixed template, exactly as it does
-- for friend_nudge.
create function public.enqueue_covered_notice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coverer_name text;
  v_circle_name text;
  v_tz text;
begin
  if new.covered_by is null then
    return new;
  end if;

  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = new.user_id and b.blocked_id = new.covered_by)
       or (b.blocker_id = new.covered_by and b.blocked_id = new.user_id)
  ) then
    return new;
  end if;

  select coalesce(u.name, 'someone in your circle') into v_coverer_name
  from public.users u where u.id = new.covered_by;

  select c.name into v_circle_name
  from public.circles c where c.id = new.circle_id;

  select coalesce(u.timezone, 'UTC') into v_tz
  from public.users u where u.id = new.user_id;

  -- One cover per member per missed day is already an RLS invariant, so
  -- this key can only ever collide with itself; DO NOTHING keeps a
  -- retried insert from raising 23505 into the Postgres log (CH5).
  insert into public.notification_outbox (user_id, kind, payload, scheduled_for, dedupe_key)
  values (
    new.user_id,
    'covered_notice',
    jsonb_build_object(
      'covererName', coalesce(v_coverer_name, 'someone in your circle'),
      'covererId', new.covered_by,
      'circleId', new.circle_id,
      'circleName', coalesce(v_circle_name, 'your circle'),
      'missed_local_date', new.local_date::text,
      -- The COVERED person's own local today. send-notifications'
      -- generic staleness guard expires any row whose payload.local_date
      -- has fallen behind the recipient's calendar date, which is
      -- exactly right here: a notice held past midnight by quiet hours
      -- would arrive naming the wrong day.
      'local_date', (now() at time zone coalesce(v_tz, 'UTC'))::date::text
    ),
    now(),
    'covered_notice-' || new.user_id::text || '-' || new.local_date::text
  )
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_covered_notice() from public, anon, authenticated;

create trigger completions_enqueue_covered_notice
  after insert on public.completions
  for each row
  when (new.kind = 'covered')
  execute function public.enqueue_covered_notice();
