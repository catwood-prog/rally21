-- Rally21 v0 schema
-- Key design point (per audit): a check-in belongs to the user's LOCAL
-- calendar day, not a server UTC day. local_date is set by the client from
-- the device clock, not derived from now() on the server.

-- ── tables (all created first so cross-table RLS policies below can
--    reference any of them regardless of definition order) ─────────────

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  avatar_url text,
  timezone text, -- IANA tz, e.g. "America/New_York" — captured client-side for future batch jobs
  created_at timestamptz not null default now()
);

create table public.practices (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  practice_id uuid references public.practices(id),
  invite_code text unique not null,
  time_of_day time,
  start_date date not null default current_date,
  duration_days int not null default 21,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  unique (circle_id, user_id)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  dimension text not null check (dimension in ('ENR','MOOD','STR','MOT','SELF','CON','VAL','HAB')),
  prompt text not null,
  format text not null check (format in ('scale','chips','short_text','binary')),
  depth text not null check (depth in ('L1','L2','L3')),
  options jsonb,
  created_at timestamptz not null default now()
);

-- one row per user, per circle, per LOCAL calendar day. A second check-in
-- the same local day is an edit, not a new row (idempotent by design).
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete cascade,
  local_date date not null,
  mood smallint check (mood between 1 and 5),
  line text,
  line2 text,
  question_id uuid references public.questions(id),
  question_answer text,
  question_skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, circle_id, local_date)
);

-- ── functions & triggers ────────────────────────────────────────────────

-- auto-create a profile row the moment someone signs up via magic link
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger checkins_set_updated_at
  before update on public.checkins
  for each row execute function public.set_updated_at();

-- join-by-code: looks up the circle without ever exposing the circles
-- table to someone who isn't a member yet (security definer bypasses RLS
-- internally, but only returns the one circle_id for a valid code)
create function public.join_circle_by_code(code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  target_circle_id uuid;
begin
  select id into target_circle_id from public.circles where invite_code = upper(code);

  if target_circle_id is null then
    raise exception 'No circle found for that code';
  end if;

  insert into public.memberships (circle_id, user_id, role)
  values (target_circle_id, auth.uid(), 'member')
  on conflict (circle_id, user_id) do nothing;

  return target_circle_id;
end;
$$;

-- ── row level security ──────────────────────────────────────────────────

alter table public.users enable row level security;
alter table public.practices enable row level security;
alter table public.circles enable row level security;
alter table public.memberships enable row level security;
alter table public.questions enable row level security;
alter table public.checkins enable row level security;

create policy "users are readable by any signed-in member"
  on public.users for select
  to authenticated
  using (true);

create policy "users can update their own profile"
  on public.users for update
  to authenticated
  using (id = auth.uid());

create policy "users can insert their own profile"
  on public.users for insert
  to authenticated
  with check (id = auth.uid());

create policy "practices are readable by any signed-in member"
  on public.practices for select
  to authenticated
  using (true);

create policy "members can read their own circles"
  on public.circles for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.circle_id = circles.id and m.user_id = auth.uid()
    )
  );

create policy "signed-in members can create a circle"
  on public.circles for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "the creator can update their circle"
  on public.circles for update
  to authenticated
  using (created_by = auth.uid());

create policy "members can see who else is in their circles"
  on public.memberships for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships mine
      where mine.circle_id = memberships.circle_id and mine.user_id = auth.uid()
    )
  );

create policy "a user can add their own membership row"
  on public.memberships for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "questions are readable by any signed-in member"
  on public.questions for select
  to authenticated
  using (true);

-- reflections (mood, line, question answer) are only ever visible to their author
create policy "a user can read only their own checkins"
  on public.checkins for select
  to authenticated
  using (user_id = auth.uid());

create policy "a user can insert only their own checkins"
  on public.checkins for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "a user can update only their own checkins"
  on public.checkins for update
  to authenticated
  using (user_id = auth.uid());

-- circle-visible presence only: who checked in, which day — never the
-- mood/line/answer content. Runs as the view owner (bypasses the
-- owner-only checkins RLS above) but filters to circle-mates itself.
create view public.checkin_presence
with (security_invoker = false) as
  select c.circle_id, c.user_id, c.local_date
  from public.checkins c
  where exists (
    select 1 from public.memberships m
    where m.circle_id = c.circle_id and m.user_id = auth.uid()
  );

grant select on public.checkin_presence to authenticated;

-- ── seed data ───────────────────────────────────────────────────────────

insert into public.practices (key, name, description) values
  ('dry-january', 'Dry January', 'A month off alcohol, together.'),
  ('couch-to-5k', 'Couch to 5K', 'Run a little further each week.'),
  ('morning-sit', 'Morning Sit', 'A few quiet minutes before the day starts.');

insert into public.questions (dimension, prompt, format, depth, options) values
  ('ENR', 'How''s your energy right now?', 'scale', 'L1', null),
  ('ENR', 'What time of day did you feel sharpest today?', 'chips', 'L1', '["Morning","Midday","Evening"]'),
  ('ENR', 'Did last night''s sleep set you up well?', 'scale', 'L1', null),
  ('ENR', 'What drained you most — people, work, screens, or your own head?', 'chips', 'L2', '["People","Work","Screens","My own head"]'),
  ('ENR', 'When your body says rest, what do you usually do?', 'chips', 'L2', '["Push through","Nap","Scroll","Actually rest"]'),
  ('MOOD', 'One word for today''s weather inside?', 'short_text', 'L1', null),
  ('MOOD', 'What gave you the biggest lift today?', 'short_text', 'L1', null),
  ('MOOD', 'Was today''s mood mostly yours, or caught from someone else?', 'chips', 'L2', '["Mine","Caught from someone"]'),
  ('MOOD', 'What emotion have you been avoiding this week?', 'short_text', 'L3', null),
  ('STR', 'Where does stress show up first — body, sleep, temper, focus?', 'chips', 'L2', '["Body","Sleep","Temper","Focus"]'),
  ('STR', 'What''s sitting on your shoulders right now?', 'short_text', 'L2', null),
  ('STR', 'What reliably restores you in under 20 minutes?', 'short_text', 'L2', null),
  ('STR', 'When did you last feel genuinely calm?', 'chips', 'L2', '["Today","Yesterday","This week","Can''t recall"]'),
  ('MOT', 'Today, did you show up for yourself or for your circle?', 'chips', 'L1', '["Myself","My circle","Both"]'),
  ('MOT', 'What works better on you — not breaking the chain, or building something?', 'chips', 'L2', '["Not breaking the chain","Building something"]'),
  ('MOT', 'When you skip a day, what''s usually the real reason?', 'chips', 'L2', '["Too busy","Forgot","Didn''t feel like it","Something got in the way"]'),
  ('MOT', 'What would make this practice feel worth it in 90 days?', 'short_text', 'L3', null),
  ('SELF', 'After today''s session — what did you say to yourself?', 'short_text', 'L2', null),
  ('SELF', 'When you miss a day, is your inner voice a coach or a critic?', 'chips', 'L2', '["Coach","Critic","Neither"]'),
  ('SELF', 'What would you tell a circle-mate who had your week?', 'short_text', 'L3', null),
  ('SELF', 'When did you last feel properly proud of yourself?', 'short_text', 'L3', null),
  ('CON', 'Who made today better?', 'short_text', 'L1', null),
  ('CON', 'Do you feel your circle would notice if you went quiet?', 'scale', 'L2', null),
  ('CON', 'Are you more giver or receiver of encouragement lately?', 'chips', 'L2', '["Giver","Receiver","Both"]'),
  ('CON', 'When did you last have a conversation that actually fed you?', 'chips', 'L3', '["Today","This week","Can''t recall"]'),
  ('VAL', 'What did you do today that was actually you?', 'short_text', 'L2', null),
  ('VAL', 'If this week had a title, what would it be?', 'short_text', 'L1', null),
  ('VAL', 'What are you doing mostly because someone else expects it?', 'short_text', 'L3', null),
  ('VAL', 'Twenty-one days from now, what do you want to be true?', 'short_text', 'L3', null),
  ('HAB', 'Where were you when you did today''s practice?', 'chips', 'L1', '["Home","Work","Outside","Somewhere else"]'),
  ('HAB', 'What nearly stopped you today?', 'short_text', 'L1', null),
  ('HAB', 'Which day of the week is hardest for you, honestly?', 'chips', 'L2', '["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]'),
  ('HAB', 'What''s the one thing that, when it happens, your whole day works?', 'short_text', 'L2', null);
