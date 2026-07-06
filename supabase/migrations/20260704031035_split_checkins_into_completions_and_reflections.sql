-- Per Rally21_MultiCircle_Spec, Prompt A: with >1 circle, the practice is
-- per-circle but the person is not. Split the single checkins table into:
--   completions  — "I did this circle's practice today." Per circle.
--   reflections  — mood + lines + question. Per person, once a day, full stop.

create table public.completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete cascade,
  local_date date not null,
  created_at timestamptz not null default now(),
  unique (circle_id, user_id, local_date)
);

alter table public.completions enable row level security;

create policy "circle members can read completions"
  on public.completions for select
  to authenticated
  using (public.is_member_of_circle(circle_id));

create policy "a user can log their own completion"
  on public.completions for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_member_of_circle(circle_id));

create table public.reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  local_date date not null,
  mood smallint check (mood between 1 and 5),
  line1 text,
  line2 text,
  question_id uuid references public.questions(id),
  question_answer text,
  question_skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_date)
);

alter table public.reflections enable row level security;

create policy "a user can read only their own reflections"
  on public.reflections for select
  to authenticated
  using (user_id = auth.uid());

create policy "a user can insert only their own reflections"
  on public.reflections for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "a user can update only their own reflections"
  on public.reflections for update
  to authenticated
  using (user_id = auth.uid());

create trigger reflections_set_updated_at
  before update on public.reflections
  for each row execute function public.set_updated_at();

-- migrate existing data: every checkin becomes one completion. Reflections
-- are deduped by (user_id, local_date), keeping the earliest — a user
-- could in principle have checked in twice same-day across two different
-- circles under the old schema; only one reflection survives per the spec.
insert into public.completions (user_id, circle_id, local_date, created_at)
select user_id, circle_id, local_date, created_at from public.checkins;

insert into public.reflections
  (user_id, local_date, mood, line1, line2, question_id, question_answer, question_skipped, created_at, updated_at)
select distinct on (user_id, local_date)
  user_id, local_date, mood, line, line2, question_id, question_answer, question_skipped, created_at, updated_at
from public.checkins
order by user_id, local_date, created_at asc;

-- repoint checkin_reactions from the old presence table to completions
alter table public.checkin_reactions
  drop constraint checkin_reactions_circle_id_target_user_id_target_local_da_fkey;

alter table public.checkin_reactions
  add constraint checkin_reactions_completions_fkey
  foreign key (circle_id, target_user_id, target_local_date)
  references public.completions (circle_id, user_id, local_date) on delete cascade;

-- retire the old presence mirror table (completions IS the content-free,
-- circle-visible presence signal now, no separate mirror needed) and the
-- old unified table (this cascades their triggers/policies away, which is
-- why checkins is dropped before its sync function)
drop table public.checkin_presence;
drop table public.checkins;
drop function public.sync_checkin_presence();

alter publication supabase_realtime add table public.completions;
