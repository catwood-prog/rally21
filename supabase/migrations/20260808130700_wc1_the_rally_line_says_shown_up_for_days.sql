-- WC1 (8 Aug 2026) — "practices" is the wrong word for the number, and
-- "days" was the wrong number for the word. This is the sentence that
-- is both.
--
-- WHAT CAT SAW on her 7 August device walk. Russ's wall carried two
-- celebrations nine seconds apart:
--
--   "Russ hit 21 days glowing 🔥"        (kind='celebration', the GLOW ladder)
--   "Russ has rallied 21 practices 🎉"   (kind='milestone',   the RALLY ladder)
--
-- IT IS NOT A DUPLICATE, and this migration does not treat it as one.
-- They are different kinds from different triggers on different ladders,
-- and every rung of the rally ladder (21, 50, 100, 365) is also a rung of
-- the glow ladder ([7,] 21, 50, 100, 365) — so the collision recurs for
-- the rest of a person's life in the app, and it inverts the warmth laws
-- while it does it: the two numbers are equal only when someone has never
-- missed, so the most consistent people get every celebration twice and
-- everyone else gets them cleanly separated.
--
-- CAT RULED KEEP BOTH, FIX ONLY THE COPY (7 Aug). She first ruled MERGE
-- and re-ruled once the finding below was put to her. So: no suppression,
-- no merged row, neither trigger's firing conditions touched, nothing
-- changed about what the rally counts. The doubling is ACCEPTED and
-- deliberately left alone. The glow line is AU1-ruled and CORRECT and is
-- not touched here.
--
-- THE FINDING THAT KILLED THE MERGE — THE TWO 21s ARE NOT THE SAME 21.
--   * The glow is PERSONAL and spans every circle: glow_qualifying_days
--     delegates to glow_day_states(p_user, p_through), which has NO
--     circle parameter anywhere.
--   * The rally milestone is PER-CIRCLE: this function counts
--     c.user_id = v_me and c.circle_id = p_circle_id and c.kind = 'self'.
-- One number is a personal run across all your circles; the other is
-- self-practices in this one circle. They were both 21 on the same
-- evening by COINCIDENCE, not because they describe one fact. A merged
-- line asserting a single shared fact would be false whenever the two
-- diverge, which is most of the time — the exact error RE1 spent six
-- sittings unpicking, where one shared stack frame fused two unrelated
-- failure modes into one imaginary family.
--
-- WHY NOT "21 days" MEANING CALENDAR DAYS. Cat's instinct ("it should be
-- 21 days") is right and the literal wording is not, and Russ's own
-- record settles it: first practice 5 July, 21st practice 30 July — 26
-- calendar days elapsed, so "rallied 21 days" would have been FALSE BY
-- FIVE. That is precisely the frozen-false-claim class AU1 fixed for the
-- glow line one migration family ago, and shipping it would have re-opened
-- the bug AU1 closed.
--
-- WHY "has shown up for N days" IS TRUE. The honest phrasing was already
-- written in the code's own comment (lib/journey.ts:5): the number is "a
-- count of days this member actually showed up". The count above is
-- distinct local dates with kind='self' — so a COVERED day correctly does
-- not count as showing up (a cover protects the glow and never advances
-- the rally), and every day in the number is a day this person really did
-- the practice. It is not elapsed days and it is not the glow.
--
-- THE STRING IS CAT'S, TWICE REFINED BY HER THE SAME DAY, and this
-- migration IMPLEMENTS it rather than proposing it: the "for" goes in
-- front of the number, because "has shown up 21 days" is ungrammatical;
-- and the scoping word "here" a docs session had proposed after the
-- number is STRUCK. The ruled string is exactly
--
--   {name} has shown up for 21 days 🎉
--
-- THE GROUP VARIANT gets the same treatment (job 2) — the same verb, the
-- same "for" in front of the number, the same absent scoping word, and
-- the co-starter clause untouched:
--
--   {names} have each shown up for 21 days 🎉 — they started the same day, July 1
--
-- THE ONE CONSEQUENCE, recorded here rather than answered in the copy:
-- the line now says nothing about WHICH circle the number belongs to,
-- while the number counts self-practices in ONE circle. On the wall it
-- renders on, context supplies the scope and the line is true. Every
-- surface this body can currently reach is circle-scoped (the wall, the
-- circle screen's wall preview, and Today's per-circle teaser card, which
-- names the circle directly above it); the digest reads wall_messages as
-- a COUNT and never as text, no notification and no share card carries a
-- wall body, and there is no cross-circle read of wall_messages anywhere.
-- Reported to Cat rather than reworded on this session's judgement.
--
-- NOT TOUCHED, DELIBERATELY: the earned check, the atomic marker update,
-- the journal_facts write, the co-starter selection, the ladder, the
-- firing conditions, and every grant except the S1 block restated below
-- (HD4's amended form — public, anon AND authenticated revoked, then
-- authenticated granted back deliberately).
--
-- Pinned from the client side by constants/strings.ts's
-- wallRallyMilestoneLine / wallRallyMilestoneTogetherLine and
-- lib/rallyMilestoneWallLine.test.ts, which reads THIS FILE and fails if
-- the two compositions ever drift apart — AU1's drift-proof pattern,
-- applied to both the solo and the group path.
--
-- STAMP: the newest migration on disk is 20260808103052 (another
-- session's, untracked at the time of writing). This is 20260808130700,
-- after it, and it touches no object that migration touches.

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
  v_me uuid := auth.uid();
  v_tz text;
  v_name text;
  v_rally_count int;
  v_start date;
  v_partners text[];
  v_all_names text;
begin
  if not is_member_of_circle(p_circle_id) then
    raise exception 'not a member of this circle';
  end if;
  if p_kind is not null and p_kind not in ('rally_marker', 'major_stop') then
    raise exception 'invalid celebration kind';
  end if;

  -- THE EARNED CHECK (PA4's follow-up, unchanged). PA1's counting rule,
  -- re-derived here rather than trusted: distinct local dates with
  -- kind='self' in THIS circle. Covers protect the glow and never
  -- advance the rally — which is also exactly why the new wording below
  -- can say "shown up" and be true.
  --
  -- This can never block a legitimate call. Both the ceremony and the
  -- quiet-celebration screen derive p_day from a count read out of this
  -- same table, so the server's count is always >= the client's; the
  -- only calls it refuses are ones describing practices that do not
  -- exist.
  --
  -- Refusing means the marker does NOT advance either, which matters as
  -- much as the silent wall: a marker wrongly set to 21 is precisely
  -- PA1's suppressor — it tells the app this member has already had
  -- their 21st-practice ceremony, so the real one never fires, forever,
  -- with nothing anywhere to show why. Quiet no-op, never an exception:
  -- a stale client that gets an error here would show the person a
  -- failure for something they did nothing wrong in.
  select count(distinct c.local_date) into v_rally_count
  from public.completions c
  where c.user_id = v_me and c.circle_id = p_circle_id and c.kind = 'self';

  if p_day > coalesce(v_rally_count, 0) then
    return;
  end if;

  update public.memberships
  set last_celebrated_day = p_day
  where circle_id = p_circle_id
    and user_id = v_me
    and last_celebrated_day < p_day;
  if not found then
    return;
  end if;

  select coalesce(timezone, 'UTC'), coalesce(name, 'someone in your circle')
  into v_tz, v_name
  from public.users where id = v_me;

  if p_kind is not null and p_body is not null then
    insert into public.journal_facts (user_id, circle_id, kind, body, local_date)
    values (v_me, p_circle_id, p_kind, p_body, (now() at time zone v_tz)::date);
  end if;

  select min(c.local_date) into v_start
  from public.completions c
  where c.user_id = v_me and c.circle_id = p_circle_id and c.kind = 'self';

  select array_agg(u.name order by u.name)
  into v_partners
  from public.memberships m
  join public.users u on u.id = m.user_id
  cross join lateral (
    select min(c.local_date) as started,
           count(distinct c.local_date) as rally_count
    from public.completions c
    where c.user_id = m.user_id and c.circle_id = p_circle_id and c.kind = 'self'
  ) r
  where m.circle_id = p_circle_id
    and m.user_id <> v_me
    and u.name is not null
    and v_start is not null
    and r.started = v_start
    and r.rally_count >= p_day;

  if v_partners is null then
    -- WC1 job 1 — Cat's ruled string, verbatim. No scoping word after
    -- the number.
    insert into public.wall_messages (circle_id, user_id, body, kind)
    values (
      p_circle_id, v_me,
      v_name || ' has shown up for ' || p_day || ' days 🎉',
      'milestone'
    );
  else
    -- WC1 job 2 — the group variant, same treatment. Only the verb
    -- phrase moved; the co-starter clause is PA4 job 4's and is
    -- untouched.
    v_all_names := array_to_string(array_prepend(v_name, v_partners), ' and ');
    insert into public.wall_messages (circle_id, user_id, body, kind)
    values (
      p_circle_id, v_me,
      v_all_names || ' have each shown up for ' || p_day || ' days 🎉 — they started the same day, '
        || to_char(v_start, 'FMMonth FMDD'),
      'milestone'
    );
  end if;
end;
$$;

-- S1, in HD4's amended form (5 Aug): `authenticated` is merged onto every
-- new function by the stored default-ACL row, so it is revoked explicitly
-- and granted back on purpose, exactly as `public` and `anon` are revoked.
revoke all on function public.mark_celebration_seen(uuid, int, text, text) from public;
revoke all on function public.mark_celebration_seen(uuid, int, text, text) from anon;
revoke all on function public.mark_celebration_seen(uuid, int, text, text) from authenticated;
grant execute on function public.mark_celebration_seen(uuid, int, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- NO BACKFILL IN THIS MIGRATION.
-- ---------------------------------------------------------------------
-- A wall row is frozen prose, so every milestone row written before this
-- migration keeps the old wording unless it is rewritten. AU1's precedent
-- is that Cat said "rewrite all 4" — but that was HER ruling, made at run
-- time on a list of the actual rows, and this one is hers to make too.
-- Job 3 puts the live rows in front of her with their bodies before and
-- after; nothing is rewritten on this session's judgement, and Russ's row
-- is on a real person's wall.
