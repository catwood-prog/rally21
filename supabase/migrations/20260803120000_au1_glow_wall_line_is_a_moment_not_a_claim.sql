-- AU1 job 1 (3 Aug) — THE GLOW DRIFT.
--
-- WHAT CAT SAW, and what it actually was. On her Today the flame under
-- her avatar read 13 and a line on her circle screen read 7. Both
-- numbers were correct. The badge, the avatar flames and this function
-- all already read ONE source — get_glow_for_user, over the
-- glow_day_states family — and a live check on 2 August confirmed all
-- three agreed: glow 13, every flame 13, and the milestone that fired on
-- 29 July was 7. Nothing was reading the wrong table.
--
-- The drift was in the TENSE. This function writes the milestone to two
-- places in the same transaction, and only one of them told the truth a
-- week later:
--
--   journal_facts: 'hit 7 days glowing on July 29, 2026'   ← a moment
--   wall_messages: 'Cathy S has been glowing 7 days 🔥'    ← a claim
--
-- A wall row is frozen prose. "has been glowing 7 days" is present
-- perfect continuous — it asserts a state that holds NOW — so from the
-- moment she reached day 8 the wall was stating something false, and by
-- day 13 it was contradicting the flame two inches away. The number was
-- never stale; the sentence was never a record.
--
-- WHY NOT RE-DERIVE IT LIVE. The obvious repair — store a marker and
-- compose the line at render time from the current glow — trades this
-- drift for a worse one. The wall is chronological: a 29 July row would
-- read "13 days" today, "20 days" next week, and 0 for anyone whose run
-- has since ended, rewriting the past every time someone scrolls. And it
-- would make a CELEBRATION quietly announce a reset, which the
-- pride-only rule below forbids outright.
--
-- So the fix is the tense, and it makes the two writes agree: the wall
-- now says what the journal already said. A moment cannot drift, which
-- is the only form of "badge and sentence can never disagree" that is
-- true of a line written once and read forever. The badge keeps stating
-- the live number, because that is what a badge is for.
--
-- Pinned from the client side by constants/strings.ts's
-- glowSocialWallLine and lib/glowWallLine.test.ts, which reads THIS FILE
-- and fails if the two compositions drift apart again.

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
  v_name text;
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

  -- The atomic gate: only the ONE call that actually advances the
  -- tracker celebrates — a concurrent duplicate finds no row to update
  -- and returns null, so the wall lines below can never double-write.
  update public.users
  set max_glow_milestone_celebrated = v_milestone
  where id = v_user and max_glow_milestone_celebrated < v_milestone;
  if not found then
    return null;
  end if;

  insert into public.journal_facts (user_id, circle_id, kind, body, local_date)
  values (
    v_user, null, 'glow_milestone',
    'hit ' || v_milestone || ' days glowing on ' || to_char(now(), 'FMMonth FMDD, YYYY'),
    (now() at time zone 'utc')::date
  );

  -- GS1: one warm line on each of this member's active circles' walls —
  -- copy composed server-side; matches constants/strings.ts's
  -- glowSocialWallLine reference copy verbatim. Completed/archived
  -- circles stay quiet. Exactly-once is inherited from the atomic gate
  -- above. Pride-only copy; a reset is never announced anywhere.
  --
  -- AU1: past tense. The number is the milestone that fired, which is
  -- what the person's glow WAS on this day — not a claim about what it
  -- is whenever the row is next read.
  select coalesce(name, 'someone in your circle') into v_name from public.users where id = v_user;

  insert into public.wall_messages (circle_id, user_id, body, kind)
  select ms.circle_id, v_user,
         v_name || ' hit ' || v_milestone || ' days glowing 🔥',
         'celebration'
  from public.memberships ms
  join public.circles c on c.id = ms.circle_id
  where ms.user_id = v_user
    and c.is_active
    and c.completed_at is null;

  return v_milestone;
end;
$$;

revoke all on function public.check_glow_milestone() from public;
revoke all on function public.check_glow_milestone() from anon;
grant execute on function public.check_glow_milestone() to authenticated;

-- The rows already written in the old tense. These are SYSTEM-composed
-- lines, not anybody's words, and each one is currently making a false
-- statement on a live wall — the four on this project's cohort include
-- the three that started this section. The rewrite preserves the fact
-- (whose milestone, which number) and changes only the tense, and the
-- anchored pattern means a member's own post that happens to quote the
-- phrase cannot be caught by it: kind='celebration' rows are
-- server-composed by definition (WL1 — members post as kind='post').
update public.wall_messages
set body = regexp_replace(
  body,
  '^(.+) has been glowing ([0-9]+) days 🔥$',
  '\1 hit \2 days glowing 🔥'
)
where kind = 'celebration'
  and body ~ '^(.+) has been glowing ([0-9]+) days 🔥$';
