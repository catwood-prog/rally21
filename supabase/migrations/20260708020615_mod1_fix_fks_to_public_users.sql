-- Fix: every other user-referencing FK in this project points to
-- public.users (the profile table PostgREST embeds against), not
-- auth.users directly — reports/blocks were created inconsistently in
-- the previous migration. public.users itself cascades from auth.users
-- (existing trigger), so the delete-cascade behavior is unchanged.
alter table public.reports drop constraint reports_reporter_id_fkey;
alter table public.reports add constraint reports_reporter_id_fkey
  foreign key (reporter_id) references public.users(id) on delete cascade;

alter table public.blocks drop constraint blocks_blocker_id_fkey;
alter table public.blocks add constraint blocks_blocker_id_fkey
  foreign key (blocker_id) references public.users(id) on delete cascade;

alter table public.blocks drop constraint blocks_blocked_id_fkey;
alter table public.blocks add constraint blocks_blocked_id_fkey
  foreign key (blocked_id) references public.users(id) on delete cascade;
