alter table public.practices add column is_shared boolean not null default false;

-- seeded practices are always shared
update public.practices set is_shared = true where created_by is null;

-- existing custom practices already used by a public circle become shared
update public.practices p
set is_shared = true
where p.created_by is not null
  and exists (
    select 1 from public.circles c
    where c.practice_id = p.id and c.is_public = true
  );

-- visibility rule: seeded practices, shared practices, and your own
-- (private or shared) practices are visible; other people's private
-- practices are invisible everywhere.
drop policy if exists "practices are readable by any signed-in member" on public.practices;
create policy "practices visible per sharing rule"
  on public.practices
  for select
  using (
    created_by is null
    or is_shared = true
    or created_by = auth.uid()
  );
