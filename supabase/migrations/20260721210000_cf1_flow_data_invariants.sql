-- CF1 (21 July) — flow data invariants: the data can't lie anymore.
--
-- 1. practices.category is DERIVED from practice_type server-side, never
--    accepted from a client — the browse-filter contamination class
--    ("Read before bed" stored under Move because a browse chip was
--    selected) dies structurally, not by review.
-- 2. ONE caller-scoped eligibility rule feeds both the open-circle tile
--    counts and the hub list, so they can never contradict each other
--    again (the live "1 open circles" vs "no open circles yet" split:
--    list_public_circles filtered closed_to_joins + own-membership but
--    not the cap; count_open_circles_by_practice filtered the cap but
--    neither of the other two).

-- ── 1a. The taxonomy's type→domain mapping as the single server-side
-- source of truth (Rally21-Practice-Taxonomy-Spec.md, PT3 cut: 18 types
-- → 5 domains — hand-synced with lib/practiceTaxonomy.ts's table).
-- IMMUTABLE so the CHECK constraint below may call it. Returns NULL for
-- an unknown key on purpose: if practice_type's own CHECK ever grows a
-- key without this mapping learning it, writes fail loudly instead of
-- guessing a shelf.
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
  end;
$$;

revoke all on function public.practice_domain_of(text) from public;
revoke all on function public.practice_domain_of(text) from anon;
grant execute on function public.practice_domain_of(text) to authenticated, service_role;

-- ── 1b. Prove no live row violates the mapping BEFORE the constraint
-- lands (a violating row would make the ADD CONSTRAINT below fail
-- anyway, but this raises with names, not a bare constraint error).
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from public.practices p
  where p.category is distinct from public.practice_domain_of(p.practice_type);
  if v_bad > 0 then
    raise exception 'CF1 precheck: % practices rows violate the type→domain mapping: %',
      v_bad,
      (select string_agg(name || ' (' || category || '/' || practice_type || ')', ', ')
       from public.practices p2
       where p2.category is distinct from public.practice_domain_of(p2.practice_type));
  end if;
end $$;

-- ── 1c. Derive on every write. The client-sent category (if any) is
-- overwritten outright — creation paths stop ACCEPTING a category in
-- any meaningful sense, whatever a request body says.
create or replace function public.derive_practice_category()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.category := public.practice_domain_of(new.practice_type);
  return new;
end;
$$;

revoke all on function public.derive_practice_category() from public;
revoke all on function public.derive_practice_category() from anon;

drop trigger if exists trg_practices_derive_category on public.practices;
create trigger trg_practices_derive_category
before insert or update on public.practices
for each row execute function public.derive_practice_category();

-- ── 1d. The invariant as a CHECK too — the trigger fires first so this
-- never trips on a normal write; it exists so the invariant survives
-- even if the trigger is ever dropped or disabled.
alter table public.practices add constraint practices_category_matches_type
  check (category = public.practice_domain_of(practice_type));

-- ── 2. ONE source of truth for "open circles". CALLER-SCOPED: rows are
-- judged for auth.uid() — the set of public circles THIS caller could
-- actually join right now: public, active, not completed, not closed to
-- joins, caller not already a member, and under the member cap. Both
-- the browse tiles' counts and the hub list read this set and nothing
-- else, so a tile can never promise a circle the list won't show.
-- Internal helper only — not granted to any client role; the two RPCs
-- below reach it as the definer.
create or replace function public.joinable_public_circles()
returns setof public.circles
language sql
stable
security definer
set search_path = public
as $$
  select c.*
  from public.circles c
  where c.is_public = true
    and c.is_active = true
    and c.completed_at is null
    and c.closed_to_joins = false
    and not exists (
      select 1 from public.memberships m
      where m.circle_id = c.id and m.user_id = auth.uid()
    )
    and (select count(*) from public.memberships m where m.circle_id = c.id)
        < (select max_members_per_circle from public.app_caps());
$$;

revoke all on function public.joinable_public_circles() from public;
revoke all on function public.joinable_public_circles() from anon;
revoke all on function public.joinable_public_circles() from authenticated;

-- The hub list: joinable_public_circles(), optionally per practice.
create or replace function public.list_public_circles(p_practice_id uuid default null)
returns table(circle_id uuid, name text, practice_name text, member_count bigint, day_number integer, duration_days integer)
language sql
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    p.name,
    (select count(*) from public.memberships m where m.circle_id = c.id),
    greatest(1, (current_date - c.start_date) + 1),
    c.duration_days
  from public.joinable_public_circles() c
  join public.practices p on p.id = c.practice_id
  where (p_practice_id is null or c.practice_id = p_practice_id)
  order by c.created_at desc;
$$;

revoke all on function public.list_public_circles(uuid) from public;
revoke all on function public.list_public_circles(uuid) from anon;
grant execute on function public.list_public_circles(uuid) to authenticated, service_role;

-- The tile counts: the SAME set, grouped. count(list(p)) == count(p)
-- by construction now.
create or replace function public.count_open_circles_by_practice()
returns table(practice_id uuid, open_circles bigint)
language sql
security definer
set search_path = public
as $$
  select c.practice_id, count(*) as open_circles
  from public.joinable_public_circles() c
  group by c.practice_id;
$$;

revoke all on function public.count_open_circles_by_practice() from public;
revoke all on function public.count_open_circles_by_practice() from anon;
grant execute on function public.count_open_circles_by_practice() to authenticated, service_role;
