-- PT1 (16 July) — the practice taxonomy (Rally21-Practice-Taxonomy-Spec.md).
-- Three levels: domain (practices.category, now exactly six), practice
-- type (new practices.practice_type — THE unit for analytics and future
-- public browsing; keys are permanent API), and the person's free-text
-- practice (unchanged). Also Cat's 13 July sharing ruling: custom
-- practices are PRIVATE by default — the four live custom rows flip to
-- is_shared = false, and RLS gains a circle-member arm so the people
-- already practising with someone's custom practice can still read it.
-- Labels only: circles, completions, glow and streaks never recompute.

-- 1. Domains — category grows from four shelves to six.
alter table public.practices drop constraint practices_category_check;
alter table public.practices add constraint practices_category_check
  check (category in ('move', 'mind', 'learn', 'make', 'connect', 'care'));

-- 2. practice_type — CHECK-constrained to the spec's 29 permanent keys.
alter table public.practices add column practice_type text;

alter table public.practices add constraint practices_practice_type_check
  check (practice_type in (
    -- move
    'walk', 'run', 'stretch', 'strength', 'sport', 'dance',
    -- mind
    'meditate', 'breathe', 'journal', 'gratitude', 'unplug',
    -- learn
    'read', 'language', 'study', 'listen',
    -- make
    'write', 'art', 'music', 'craft', 'build',
    -- connect
    'reach-out', 'quality-time', 'kindness',
    -- care
    'sleep', 'eat', 'hydrate', 'tidy', 'money', 'self-care'
  ));

-- 3. Backfill — the spec's table, covering all seven live rows (and, on
-- a fresh replay, the three seeded meditation rows, matched by key so
-- this never depends on cohort data existing).
update public.practices set practice_type = 'meditate'
  where key in ('meditation-5', 'meditation-10', 'meditation-15');
update public.practices set practice_type = 'breathe'
  where created_by is not null and name = 'Breath of Fire & Fists of Anger';
update public.practices set practice_type = 'stretch'
  where created_by is not null and name = 'Stretching/Yoga moves';
update public.practices set practice_type = 'strength'
  where created_by is not null and name = 'Workout - no equipment needed';
-- The row that caused all this: "Read before bed" was stored as category
-- 'move' (the browse chip leak). It is reading → learn / read.
update public.practices set category = 'learn', practice_type = 'read'
  where created_by is not null and name = 'Read before bed';

-- Fail LOUDLY if any row slipped through the backfill — a silent stray
-- would make the NOT NULL below impossible to trust.
do $$
begin
  if exists (select 1 from public.practices where practice_type is null) then
    raise exception 'PT1 backfill incomplete: practices rows without practice_type: %',
      (select string_agg(name, ', ') from public.practices where practice_type is null);
  end if;
end;
$$;

-- New rows require both labels from here on.
alter table public.practices alter column practice_type set not null;

-- 4. Sharing — customs are private by default (Cat, 13 July). The four
-- existing custom rows flip to false; the browse catalogue becomes
-- "curated system practices + your own customs" (client-side filter in
-- listPracticesByCategory). is_shared stays as the mechanism, and
-- create_circle's one-directional public-circle flip is untouched.
update public.practices set is_shared = false where created_by is not null;

-- 5. RLS — the flip above must NOT hide a practice from the circle-mates
-- already using it. SECURITY DEFINER helper (mirrors is_member_of_circle,
-- avoids nested policy evaluation), then the SELECT policy gains a
-- circle-member arm. S1/G5 hygiene: search_path pinned, explicit
-- public/anon revokes before the real grant.
create function public.practice_used_by_my_circle(p_practice_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.circles c
    join public.memberships m on m.circle_id = c.id
    where c.practice_id = p_practice_id
      and m.user_id = auth.uid()
  );
$$;

revoke all on function public.practice_used_by_my_circle(uuid) from public;
revoke all on function public.practice_used_by_my_circle(uuid) from anon;
grant execute on function public.practice_used_by_my_circle(uuid) to authenticated;

drop policy "practices visible per sharing rule" on public.practices;
create policy "practices visible per sharing rule"
  on public.practices
  for select
  using (
    created_by is null
    or is_shared = true
    or created_by = auth.uid()
    or public.practice_used_by_my_circle(id)
  );

-- 6. edit_circle's clone path must carry the taxonomy — practice_type is
-- NOT NULL now, and a clone keeps the original's labels (the host is
-- rewording their practice, not recategorising it; my-practices is where
-- labels change). Full recreate of the EC1 function with the one-line
-- widening of the clone INSERT.
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
  update public.circles
  set name = v_name,
      time_of_day = coalesce(p_time_of_day, time_of_day),
      resource_url = v_url
  where id = p_circle_id;

  if v_practice_name is not null and v_circle.practice_id is not null then
    select * into v_practice from public.practices where id = v_circle.practice_id;

    if v_practice.name is distinct from v_practice_name
       or v_practice.duration_minutes is distinct from p_practice_duration_minutes then
      select count(*) into v_other_circles
      from public.circles
      where practice_id = v_practice.id and id <> p_circle_id;

      if v_practice.created_by = auth.uid() and v_other_circles = 0 then
        update public.practices
        set name = v_practice_name,
            duration_minutes = p_practice_duration_minutes
        where id = v_practice.id;
      else
        -- Clone: same category/type/description, owned by the host.
        -- Private unless this circle is public — the same
        -- one-directional is_shared rule create_circle applies
        -- (CLAUDE.md's practice-privacy convention). The
        -- practices_set_key trigger derives the clone's key from its
        -- own id.
        insert into public.practices
          (name, description, category, practice_type, duration_minutes, created_by, is_shared)
        values
          (v_practice_name, v_practice.description, v_practice.category,
           v_practice.practice_type, p_practice_duration_minutes, auth.uid(),
           v_circle.is_public)
        returning id into v_new_practice_id;

        update public.circles
        set practice_id = v_new_practice_id
        where id = p_circle_id;
      end if;
    end if;
  end if;
end;
$$;

-- S1/G5 convention: the project's default ACL still grants EXECUTE to
-- anon/PUBLIC on new functions — revoke explicitly, then grant.
revoke all on function public.edit_circle(uuid, text, time without time zone, text, text, int) from public;
revoke all on function public.edit_circle(uuid, text, time without time zone, text, text, int) from anon;
grant execute on function public.edit_circle(uuid, text, time without time zone, text, text, int) to authenticated;
