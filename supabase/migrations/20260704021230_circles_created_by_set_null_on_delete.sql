-- Deleting a circle's creator (e.g. via account deletion) must not fail
-- or take the circle down with them -- the circle should survive for
-- remaining members, just with no recorded creator.
alter table public.circles drop constraint circles_created_by_fkey;
alter table public.circles
  add constraint circles_created_by_fkey
  foreign key (created_by) references public.users(id) on delete set null;
