-- PB1 (21 July) — the practice bank seeded + durations move to the circle.
-- Seed source of truth: Rally21-Practice-Bank-Final.md (Cat, FINAL 21 July,
-- incl. the evening rulings). Five jobs in strict order:
--   0. selfcare reinstated — taxonomy 18 → 19 types (a conscious partial
--      reversal of the 16 July prune; care domain: eat + selfcare).
--   1. circles.duration_minutes — the dose lives on the circle from now
--      on; every live circle backfilled from its practice BEFORE any row
--      moves. practices.duration_minutes becomes legacy (still the copy
--      source at creation until CF2's setup screens land; removal
--      ledgered in DEFERRED.md).
--   2. Meditate consolidation — 3 time-variant seeds → one "Meditate"
--      (Cat approved incl. the live "Daily Meditation" circle; its
--      15-minute timer survives via the job-1 backfill, proven below).
--   3. The 57-row bank: 56 inserts + the consolidated Meditate row.
--      category is NEVER written by hand — CF1's trigger derives it.
--   4. practices.timer_suggested — pre-suggestion only (Cat's timer
--      rule: ANY practice may take an optional duration at setup, none
--      is forced; no hard split exists anywhere).

-- ── 0. selfcare reinstated: constraint, mapping function, self-proof ──

alter table public.practices drop constraint practices_practice_type_check;
alter table public.practices add constraint practices_practice_type_check
  check (practice_type in (
    -- move
    'walk', 'run', 'stretch', 'strength', 'sport', 'dance',
    -- mind
    'meditate', 'breathe', 'journal', 'gratitude', 'affirm',
    -- learn
    'read', 'language', 'study', 'music',
    -- make
    'write', 'art',
    -- care
    'eat', 'selfcare'
  ));

-- CF1's single server-side type→domain source of truth learns the key
-- (hand-synced with lib/practiceTaxonomy.ts, same rule as CF1: an
-- unknown key maps to NULL so writes fail loudly, never guess a shelf).
create or replace function public.practice_domain_of(p_practice_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_practice_type
    when 'walk' then 'move'
    when 'run' then 'move'
    when 'stretch' then 'move'
    when 'strength' then 'move'
    when 'sport' then 'move'
    when 'dance' then 'move'
    when 'meditate' then 'mind'
    when 'breathe' then 'mind'
    when 'journal' then 'mind'
    when 'gratitude' then 'mind'
    when 'affirm' then 'mind'
    when 'read' then 'learn'
    when 'language' then 'learn'
    when 'study' then 'learn'
    when 'music' then 'learn'
    when 'write' then 'make'
    when 'art' then 'make'
    when 'eat' then 'care'
    when 'selfcare' then 'care'
  end;
$$;

-- Same grants as CF1 laid down (replace keeps the ACL, but state them —
-- S1/G5 convention: explicit revoke before the real grant, always).
revoke all on function public.practice_domain_of(text) from public;
revoke all on function public.practice_domain_of(text) from anon;
grant execute on function public.practice_domain_of(text) to authenticated, service_role;

-- Prove the amended mapping + that CF1's category CHECK still holds for
-- every existing row (the CHECK calls the function we just replaced).
do $$
declare
  v_bad int;
begin
  if public.practice_domain_of('selfcare') is distinct from 'care' then
    raise exception 'PB1 job 0: selfcare must map to care';
  end if;
  if public.practice_domain_of('sleep') is not null then
    raise exception 'PB1 job 0: retired key sleep must still map to NULL';
  end if;
  select count(*) into v_bad
  from public.practices p
  where p.category is distinct from public.practice_domain_of(p.practice_type);
  if v_bad > 0 then
    raise exception 'PB1 job 0: % rows now violate the type→domain mapping', v_bad;
  end if;
end $$;

-- ── 1. the dose moves to the circle ──────────────────────────────────

alter table public.circles add column duration_minutes integer;

-- timer_suggested: setup PRE-SUGGESTS a timer for these rows, nothing
-- more. Existing rows (incl. customs) default false; the bank seed below
-- sets it per the Completion column.
alter table public.practices add column timer_suggested boolean not null default false;

-- Backfill every live circle from its practice's current duration —
-- BEFORE the meditate rows move, so "Daily Meditation" captures its 15.
update public.circles c
set duration_minutes = p.duration_minutes
from public.practices p
where p.id = c.practice_id
  and p.duration_minutes is not null;

-- Guard: no circle whose practice carries a dose is left without one.
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from public.circles c
  join public.practices p on p.id = c.practice_id
  where p.duration_minutes is not null
    and c.duration_minutes is distinct from p.duration_minutes;
  if v_bad > 0 then
    raise exception 'PB1 job 1: % circles missed the duration backfill', v_bad;
  end if;
end $$;

-- ── 2. Meditate consolidation (after the backfill, by construction) ──
-- Canonical row = the zero-circle 'meditation-10' seed, renamed; the
-- circles on 'meditation-5'/'meditation-15' repoint to it; those two
-- rows archive. Nothing here names cohort circles — replay-safe.
do $$
declare
  v_canonical uuid;
begin
  select id into v_canonical
  from public.practices
  where key = 'meditation-10' and created_by is null;
  if v_canonical is null then
    raise exception 'PB1 job 2: canonical meditate seed (meditation-10) not found';
  end if;

  update public.practices
  set name = 'Meditate',
      key = 'meditate',
      duration_minutes = null,
      timer_suggested = true
  where id = v_canonical;

  update public.circles c
  set practice_id = v_canonical
  from public.practices p
  where p.id = c.practice_id
    and p.created_by is null
    and p.key in ('meditation-5', 'meditation-15');

  update public.practices
  set is_archived = true
  where created_by is null
    and key in ('meditation-5', 'meditation-15');
end $$;

-- Guards: exactly one live meditate seed; no circle points at an
-- archived practice; no circle lost its captured dose in the repoint.
do $$
declare
  v_meditate int;
  v_orphaned int;
begin
  select count(*) into v_meditate
  from public.practices
  where created_by is null and practice_type = 'meditate' and not is_archived;
  if v_meditate <> 1 then
    raise exception 'PB1 job 2: expected exactly 1 live meditate seed, found %', v_meditate;
  end if;

  select count(*) into v_orphaned
  from public.circles c
  join public.practices p on p.id = c.practice_id
  where p.is_archived;
  if v_orphaned > 0 then
    raise exception 'PB1 job 2: % circles still reference an archived practice', v_orphaned;
  end if;
end $$;

-- ── 3. create_circle copies the practice's dose onto the new circle ──
-- Full recreate of the OC1 (13 July) definition + one variable: the new
-- circle is born with duration_minutes = its practice's legacy value, so
-- the current UI (customs type a duration at creation; seeds now carry
-- none) keeps working unchanged until CF2's setup screens write the
-- circle duration explicitly.
create or replace function public.create_circle(
  p_practice_key text,
  p_time_of_day time without time zone,
  p_circle_name text,
  p_is_public boolean default false
)
returns table(circle_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_practice_id uuid;
  v_duration int;
  v_circle_id uuid;
  v_code text;
  v_chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_attempt int := 0;
  v_name text := nullif(trim(p_circle_name), '');
  v_my_circle_count int;
  v_max_circles int;
begin
  select max_circles_per_user into v_max_circles from public.app_caps();

  select count(*) into v_my_circle_count from public.memberships where user_id = auth.uid();
  if v_my_circle_count >= v_max_circles then
    raise exception 'You''re in % circles already — finish one or leave one to add another.', v_max_circles;
  end if;

  select id, duration_minutes into v_practice_id, v_duration
  from public.practices where key = p_practice_key;
  if v_practice_id is null then
    raise exception 'Unknown practice: %', p_practice_key;
  end if;

  if v_name is null then
    select name into v_name from public.practices where id = v_practice_id;
  end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    end loop;

    begin
      insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public, duration_minutes)
      values (v_name, v_practice_id, v_code, p_time_of_day, auth.uid(), coalesce(p_is_public, false), v_duration)
      returning id into v_circle_id;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 5 then
        raise exception 'Could not generate a unique invite code — try again';
      end if;
    end;
  end loop;

  if coalesce(p_is_public, false) then
    update public.practices set is_shared = true where id = v_practice_id;
  end if;

  insert into public.memberships (circle_id, user_id, role, join_source)
  values (v_circle_id, auth.uid(), 'owner', 'creator');

  return query select v_circle_id, v_code;
end;
$$;

revoke all on function public.create_circle(text, time without time zone, text, boolean) from public;
revoke all on function public.create_circle(text, time without time zone, text, boolean) from anon;
grant execute on function public.create_circle(text, time without time zone, text, boolean) to authenticated;

-- ── 4. edit_circle writes the CIRCLE's dose ──────────────────────────
-- Same signature as EC1/PT1 (cached clients keep working). The duration
-- param now writes circles.duration_minutes directly (null clears it);
-- the practice row is touched ONLY when its name changes (rewording),
-- with EC1's own-and-unshared-else-clone rule intact. The clone insert
-- no longer writes category — CF1's trigger derives it.
create or replace function public.edit_circle(
  p_circle_id uuid,
  p_name text,
  p_time_of_day time without time zone,
  p_resource_url text,
  p_practice_name text,
  p_practice_duration_minutes int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_circle public.circles%rowtype;
  v_practice public.practices%rowtype;
  v_name text := nullif(trim(p_name), '');
  v_practice_name text := nullif(trim(p_practice_name), '');
  v_url text := nullif(trim(p_resource_url), '');
  v_other_circles int;
  v_new_practice_id uuid;
begin
  select * into v_circle from public.circles where id = p_circle_id;

  -- Host-only, enforced here at the database (matches the circles
  -- UPDATE policy's created_by = auth.uid()); no host handover exists,
  -- so this is always the original creator (see CLAUDE.md).
  if v_circle.id is null or v_circle.created_by is distinct from auth.uid() then
    raise exception 'Only the circle''s host can edit it';
  end if;

  if v_name is null then
    raise exception 'The circle needs a name';
  end if;

  -- resource_url: null/blank clears the link; a non-http value is
  -- rejected by the circles_resource_url_http_check constraint.
  -- duration: PB1 — the dose is circle-level, written here outright.
  update public.circles
  set name = v_name,
      time_of_day = coalesce(p_time_of_day, time_of_day),
      resource_url = v_url,
      duration_minutes = p_practice_duration_minutes
  where id = p_circle_id;

  if v_practice_name is not null and v_circle.practice_id is not null then
    select * into v_practice from public.practices where id = v_circle.practice_id;

    if v_practice.name is distinct from v_practice_name then
      select count(*) into v_other_circles
      from public.circles
      where practice_id = v_practice.id and id <> p_circle_id;

      if v_practice.created_by = auth.uid() and v_other_circles = 0 then
        update public.practices
        set name = v_practice_name
        where id = v_practice.id;
      else
        -- Clone: same type/description/legacy duration, owned by the
        -- host. Private unless this circle is public — the same
        -- one-directional is_shared rule create_circle applies
        -- (CLAUDE.md's practice-privacy convention). The
        -- practices_set_key trigger derives the clone's key from its
        -- own id; CF1's trigger derives category.
        insert into public.practices
          (name, description, practice_type, duration_minutes, created_by, is_shared, timer_suggested)
        values
          (v_practice_name, v_practice.description, v_practice.practice_type,
           v_practice.duration_minutes, auth.uid(), v_circle.is_public,
           v_practice.timer_suggested)
        returning id into v_new_practice_id;

        update public.circles
        set practice_id = v_new_practice_id
        where id = p_circle_id;
      end if;
    end if;
  end if;
end;
$$;

revoke all on function public.edit_circle(uuid, text, time without time zone, text, text, int) from public;
revoke all on function public.edit_circle(uuid, text, time without time zone, text, text, int) from anon;
grant execute on function public.edit_circle(uuid, text, time without time zone, text, text, int) to authenticated;

-- ── 5. seed the bank — 56 inserts (Meditate already lives, job 2) ────
-- Verbatim from Rally21-Practice-Bank-Final.md's table. No durations on
-- names or rows; timer_suggested true = the table's "Optional timer".
-- category is absent from the column list on purpose — the CF1 trigger
-- derives it from practice_type (VERIFY pastes zero hand-written rows).
-- is_shared true explicitly per the S1 seeding convention.
insert into public.practices (key, name, practice_type, timer_suggested, created_by, is_shared)
values
  -- move / walk
  ('walk',                                  'Walk',                                  'walk',      true,  null, true),
  ('take-a-walk-after-lunch',               'Take a walk after lunch',               'walk',      false, null, true),
  -- move / run
  ('run',                                   'Run',                                   'run',       true,  null, true),
  ('do-one-run-walk-session',               'Do one run–walk session',               'run',       false, null, true),
  ('go-for-an-easy-run',                    'Go for an easy run',                    'run',       false, null, true),
  -- move / stretch
  ('stretch',                               'Stretch',                               'stretch',   true,  null, true),
  ('do-yoga',                               'Do yoga',                               'stretch',   true,  null, true),
  ('stretch-before-bed',                    'Stretch before bed',                    'stretch',   false, null, true),
  -- move / strength
  ('do-a-strength-session',                 'Do a strength session',                 'strength',  true,  null, true),
  ('do-one-no-equipment-workout',           'Do one no-equipment workout',           'strength',  false, null, true),
  ('do-10-squats',                          'Do 10 squats',                          'strength',  false, null, true),
  ('do-glute-bridges',                      'Do glute bridges',                      'strength',  true,  null, true),
  -- move / sport
  ('swim',                                  'Swim',                                  'sport',     true,  null, true),
  ('cycle',                                 'Cycle',                                 'sport',     true,  null, true),
  ('practice-a-sport',                      'Practice a sport',                      'sport',     false, null, true),
  -- move / dance
  ('dance',                                 'Dance',                                 'dance',     true,  null, true),
  ('dance-to-one-song',                     'Dance to one song',                     'dance',     false, null, true),
  ('learn-one-short-dance-sequence',        'Learn one short dance sequence',        'dance',     false, null, true),
  -- mind / breathe
  ('breathe-slowly',                        'Breathe slowly',                        'breathe',   true,  null, true),
  ('take-10-slow-breaths',                  'Take 10 slow breaths',                  'breathe',   false, null, true),
  ('do-one-breathing-exercise',             'Do one breathing exercise',             'breathe',   false, null, true),
  -- mind / journal
  ('journal',                               'Journal',                               'journal',   true,  null, true),
  ('write-three-lines-about-today',         'Write three lines about today',         'journal',   false, null, true),
  ('write-one-sentence-before-bed',         'Write one sentence before bed',         'journal',   false, null, true),
  -- mind / gratitude
  ('write-down-three-good-things',          'Write down three good things',          'gratitude', false, null, true),
  ('thank-someone-today',                   'Thank someone today',                   'gratitude', false, null, true),
  ('notice-one-thing-that-went-well',       'Notice one thing that went well',       'gratitude', false, null, true),
  -- mind / affirm
  ('say-one-kind-thing-to-myself',          'Say one kind thing to myself',          'affirm',    false, null, true),
  ('read-my-affirmation-aloud',             'Read my affirmation aloud',             'affirm',    false, null, true),
  ('write-one-encouraging-sentence',        'Write one encouraging sentence',        'affirm',    false, null, true),
  -- learn / read
  ('read-10-pages',                         'Read 10 pages',                         'read',      false, null, true),
  ('read',                                  'Read',                                  'read',      true,  null, true),
  ('read-before-bed',                       'Read before bed',                       'read',      false, null, true),
  -- learn / language
  ('practice-a-language',                   'Practice a language',                   'language',  true,  null, true),
  ('complete-one-language-lesson',          'Complete one language lesson',          'language',  false, null, true),
  ('review-10-words',                       'Review 10 words',                       'language',  false, null, true),
  -- learn / study
  ('study',                                 'Study',                                 'study',     true,  null, true),
  ('review-one-page-of-notes',              'Review one page of notes',              'study',     false, null, true),
  ('complete-one-lesson',                   'Complete one lesson',                   'study',     false, null, true),
  -- learn / music
  ('practice-my-instrument',                'Practice my instrument',                'music',     true,  null, true),
  ('practice-scales',                       'Practice scales',                       'music',     true,  null, true),
  ('play-one-song',                         'Play one song',                         'music',     false, null, true),
  -- make / write
  ('write-200-words',                       'Write 200 words',                       'write',     false, null, true),
  ('write',                                 'Write',                                 'write',     true,  null, true),
  ('write-one-paragraph',                   'Write one paragraph',                   'write',     false, null, true),
  -- make / art
  ('sketch',                                'Sketch',                                'art',       true,  null, true),
  ('draw-one-small-thing',                  'Draw one small thing',                  'art',       false, null, true),
  ('work-on-an-art-project',                'Work on an art project',                'art',       true,  null, true),
  -- care / eat
  ('drink-a-glass-of-water-when-i-wake-up', 'Drink a glass of water when I wake up', 'eat',       false, null, true),
  ('eat-breakfast',                         'Eat breakfast',                         'eat',       false, null, true),
  ('take-my-vitamins',                      'Take my vitamins',                      'eat',       false, null, true),
  ('drink-2-litres-of-water',               'Drink 2 litres of water',               'eat',       false, null, true),
  ('eat-one-meal-without-screens',          'Eat one meal without screens',          'eat',       false, null, true),
  ('go-alcohol-free',                       'Go alcohol-free',                       'eat',       false, null, true),
  -- care / selfcare (reinstated type — the two evening-ruling rows)
  ('take-time-for-yourself',                'Take time for yourself',                'selfcare',  true,  null, true),
  ('give-yourself-a-massage',               'Give yourself a massage',               'selfcare',  false, null, true);

-- ── 6. the whole-bank proof ──────────────────────────────────────────
do $$
declare
  v_bank int;
  v_suggested int;
  v_bad_cat int;
begin
  select count(*) into v_bank
  from public.practices where created_by is null and not is_archived;
  if v_bank <> 57 then
    raise exception 'PB1: expected the 57-row bank, found % live seed rows', v_bank;
  end if;

  -- 21 "Optional timer" rows in the final table (20 inserted + Meditate).
  select count(*) into v_suggested
  from public.practices
  where created_by is null and not is_archived and timer_suggested;
  if v_suggested <> 21 then
    raise exception 'PB1: expected 21 timer-suggested bank rows, found %', v_suggested;
  end if;

  select count(*) into v_bad_cat
  from public.practices p
  where p.category is distinct from public.practice_domain_of(p.practice_type);
  if v_bad_cat > 0 then
    raise exception 'PB1: % rows carry a category the trigger did not derive', v_bad_cat;
  end if;
end $$;
