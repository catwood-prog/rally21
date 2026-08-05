-- AN1 job 2 (5 Aug) — funnel_events: the genuinely unrecorded moments,
-- and NOTHING ELSE.
--
-- The brief guessed a two-thirds-derived / one-third-new split. Re-grepped
-- against HEAD before writing a line of this, the derivable side is larger
-- than that and this table is deliberately smaller. What already leaves a
-- timestamp, and therefore is NOT duplicated here:
--
--   account created            auth.users.created_at
--   reminders ask ANSWERED     users.reminders_ask_seen_at (RM1)
--   photo ask answered         users.photo_ask_seen_at (AV1)
--   circle joined or started   memberships.joined_at + join_source (OC1)
--   first practice             completions.created_at where kind='self'
--   push token registered      device_tokens.created_at (PN1)
--   share card sent            card_events (SC1)
--
-- What genuinely leaves nothing, verified in the source:
--
--   * The onboarding STEPS THEMSELVES. `users.name` records that the
--     profile step finished but carries no timestamp of its own, and
--     `reminders_ask_seen_at` is written on CONTINUE only
--     (onboarding/reminders.tsx handleTurnOn / handleMaybeLater), never on
--     arrival. So "opened this step and left" — the whole of in-onboarding
--     abandonment — is invisible today.
--   * The circle-setup FORK. onboarding/circle-setup.tsx offers three
--     doors (start / join with a code / solo). join_source records which
--     door a person came THROUGH, but only for the people who made it;
--     the ones who picked a door and bounced record nothing.
--   * INVITES SENT. onboarding/invite.tsx hands the message to the OS
--     share sheet, the in-app channel chooser, or the clipboard. Not one
--     of those paths touches the database — there is no invites table
--     anywhere in this schema. The ACCEPTED side already lives in
--     join_source='invite'; this table supplies the sent side, which is
--     the missing half of the k-factor seed.
--
-- HOUSE LAW, ENFORCED BY THE SCHEMA RATHER THAN BY REVIEW: an event row
-- carries an id, an enum key and a timestamp. There is deliberately NO
-- text column on this table — the key is a real Postgres enum type, so
-- free text cannot be written here even by a future careless caller, and
-- "never user text" stops being a convention someone has to remember.
-- Adding a value is a migration, which is the point.

create type public.funnel_event_key as enum (
  -- Onboarding step boundaries. `_opened` fires on arrival at the step,
  -- so an `_opened` with no matching completion IS the abandonment.
  'onboarding_profile_opened',
  'onboarding_profile_saved',
  'onboarding_reminders_opened',
  'onboarding_circle_setup_opened',
  -- Which of the three doors was picked. Success still lands in
  -- join_source; these record the INTENT, which is what abandonment needs.
  'onboarding_circle_setup_start_chosen',
  'onboarding_circle_setup_join_chosen',
  'onboarding_circle_setup_solo_chosen',
  -- Invite-SENT moments. The OS never tells us a message was actually
  -- delivered, so these are honestly named for what they observe: the
  -- person opened a send path. They are the sent side of the k-factor.
  'invite_share_opened',
  'invite_channel_chosen',
  'invite_code_copied'
);

comment on type public.funnel_event_key is
  'AN1 — the fixed enum of funnel moments nothing else stamps. Making this '
  'a type rather than a text check is what makes "ids and timestamps only, '
  'never user text" a schema property instead of a review habit.';

create table public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event public.funnel_event_key not null,
  created_at timestamptz not null default now()
);

comment on table public.funnel_events is
  'AN1 job 2 — first-party activation funnel events for the moments no '
  'existing table stamps. No text columns by construction. Insert-own '
  'authenticated; SELECT is founder-only.';

-- The lens reads this per user and per cohort week, always by event key.
create index funnel_events_user_event_idx
  on public.funnel_events (user_id, event, created_at);
create index funnel_events_event_created_idx
  on public.funnel_events (event, created_at);

alter table public.funnel_events enable row level security;

revoke all on table public.funnel_events from public;
revoke all on table public.funnel_events from anon;
grant select, insert on table public.funnel_events to authenticated;

-- Insert-own only: a client may record that IT did something, never that
-- somebody else did. There is no UPDATE or DELETE policy at all, so a row
-- is append-only from the client side once written.
create policy funnel_events_insert_own
  on public.funnel_events
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- SELECT is founder-only, the same shape as card_events (SC1/PM2): a
-- person's own funnel is of no use to them and reading anyone else's is
-- the thing to prevent. is_founder() is auth.uid()-aware and STABLE.
create policy funnel_events_select_founder
  on public.funnel_events
  for select
  to authenticated
  using (public.is_founder());
