-- PT3 (17 July) — the taxonomy re-cut: 29 keys / 6 domains → 18 keys /
-- 5 domains, per Rally21-Practice-Taxonomy-Spec.md's 16 July revision
-- (Cat's rulings confirmed 17 July). "Keys are permanent once shipped"
-- bends here ONLY because every retired key is proven row-free — the
-- zero-row proof (live, 17 July: the seven rows sit on meditate ×3,
-- breathe, stretch, strength, read; nothing on any removed type, the
-- connect domain, or music) is the licence for this whole migration.
-- If that proof ever fails on a replay target, the DO block below
-- aborts loudly instead of cutting.
--
-- Removed types (12): unplug, craft, build, reach-out, quality-time,
-- kindness, sleep, hydrate, tidy, money, self-care, listen. The connect
-- domain goes with its types. affirm is NEW (mind). music MOVES
-- make → learn (display stays Music). Rows never remap silently — the
-- guard proves there is nothing to remap.

-- Guard: refuse to cut if any row uses a retiring key or domain, or if
-- a music row exists whose category the move below wouldn't fix.
do $$
declare
  v_stragglers text;
begin
  select string_agg(name || ' (' || category || '/' || practice_type || ')', ', ')
  into v_stragglers
  from public.practices
  where practice_type in (
      'unplug', 'craft', 'build', 'reach-out', 'quality-time', 'kindness',
      'sleep', 'hydrate', 'tidy', 'money', 'self-care', 'listen'
    )
    or category = 'connect';
  if v_stragglers is not null then
    raise exception 'PT3 re-cut blocked: rows still use retired types/domains: %', v_stragglers;
  end if;
end;
$$;

-- music's domain moves make → learn (zero live rows today; correct on
-- any replay where music rows exist).
update public.practices set category = 'learn' where practice_type = 'music';

-- Domains: six shelves → five (connect retired).
alter table public.practices drop constraint practices_category_check;
alter table public.practices add constraint practices_category_check
  check (category in ('move', 'mind', 'learn', 'make', 'care'));

-- Types: the 18-key table, exactly.
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
    'eat'
  ));
