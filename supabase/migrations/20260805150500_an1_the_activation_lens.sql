-- AN1 job 1 (5 Aug) — the activation lens, reconstructed RETROACTIVELY
-- from tables that were already keeping timestamps.
--
-- WHY A PRIVATE SCHEMA AND NOT A public VIEW. A view in `public` is
-- exposed by PostgREST, and a view owned by postgres runs as its owner, so
-- it would read straight past every RLS policy on the tables underneath —
-- a whole-cohort read for anyone holding an anon key. `analytics` is not
-- in Supabase's exposed-schema list and is granted to nobody, so the views
-- are unreachable over the API by construction. Two doors are opened
-- deliberately: the dashboard SQL editor (which connects as postgres, and
-- is how Cat reads the weekly block WITHOUT a session — see
-- supabase/analytics/weekly-funnel.sql), and one founder-gated RPC in
-- `public` for reading it from a session. Same reasoning as the enum in
-- the funnel_events migration: make the guarantee structural, not a habit.
--
-- WHAT THESE NUMBERS ARE. Counts. Not conclusions. Cat settled the premise
-- on 28 July: every account in this project today is Cat, Russ, her
-- brother or her dad — family testing, not an outside cohort — so no
-- behavioural reading of any row here is valid yet. The lens is being
-- built before the testers arrive so their numbers are recorded from day
-- one, not so today's are interpreted.

create schema if not exists analytics;

comment on schema analytics is
  'AN1 — founder-only derived views. Deliberately NOT a PostgREST-exposed '
  'schema and granted to no role: reachable from the dashboard (postgres) '
  'and via the founder-gated RPCs in public, and nowhere else.';

revoke all on schema analytics from public;
revoke all on schema analytics from anon;
revoke all on schema analytics from authenticated;

-- ---------------------------------------------------------------------
-- analytics.funnel_person — one row per live account, every stage.
-- ---------------------------------------------------------------------
create or replace view analytics.funnel_person as
with account as (
  select
    u.id                                                      as user_id,
    u.created_at                                              as signed_up_at,
    (u.created_at at time zone 'utc')::date                   as signup_date,
    date_trunc('week', u.created_at at time zone 'utc')::date as cohort_week
  from auth.users u
  where u.deleted_at is null
),
circle_size as (
  select circle_id, count(*) as member_count
  from public.memberships
  group by circle_id
),
first_join as (
  select distinct on (m.user_id)
    m.user_id,
    m.joined_at    as first_joined_at,
    m.join_source  as first_join_source
  from public.memberships m
  order by m.user_id, m.joined_at, m.id
),
memb as (
  select
    m.user_id,
    count(*)                                              as circles_joined,
    count(*) filter (where m.join_source = 'creator')     as joined_as_creator,
    count(*) filter (where m.join_source = 'invite')      as joined_via_invite,
    count(*) filter (where m.join_source = 'browse')      as joined_via_browse,
    count(*) filter (where m.finished_at is not null)     as memberships_finished,
    bool_or(cs.member_count > 1)                          as ever_had_company,
    max(cs.member_count)                                  as largest_circle_size
  from public.memberships m
  join circle_size cs on cs.circle_id = m.circle_id
  group by m.user_id
),
selfc as (
  select
    c.user_id,
    min(c.created_at)             as first_self_checkin_at,
    min(c.local_date)             as first_self_local_date,
    max(c.local_date)             as last_self_local_date,
    count(distinct c.local_date)  as self_days_any_circle
  from public.completions c
  where c.kind = 'self'
  group by c.user_id
),
-- The personal-arc law, in the memo's own words and PA1/PA2/PA4's exact
-- expression: a rally is counted in PRACTICES, per user per circle, and
-- `kind='self'` ONLY. Covered and away days protect the glow and never
-- advance the rally — counting them would re-inflate the number the memo
-- exists to remove (Rally21-Personal-Arc-Decision-Memo.md §4).
rally as (
  select
    m.user_id,
    max(r.rally_count)                                 as best_rally_count,
    count(*) filter (where r.rally_count >= 21)        as memberships_reaching_rally_21,
    count(*) filter (where r.rally_count > 21)         as memberships_past_rally_21
  from public.memberships m
  cross join lateral (
    select count(distinct c.local_date) as rally_count
    from public.completions c
    where c.user_id = m.user_id
      and c.circle_id = m.circle_id
      and c.kind = 'self'
  ) r
  group by m.user_id
),
fe as (
  select
    f.user_id,
    min(f.created_at) filter (where f.event = 'onboarding_profile_opened')       as profile_opened_at,
    min(f.created_at) filter (where f.event = 'onboarding_profile_saved')        as profile_saved_at,
    min(f.created_at) filter (where f.event = 'onboarding_reminders_opened')     as reminders_opened_at,
    min(f.created_at) filter (where f.event = 'onboarding_circle_setup_opened')  as circle_setup_opened_at,
    (count(*) filter (where f.event in (
      'onboarding_circle_setup_start_chosen',
      'onboarding_circle_setup_join_chosen',
      'onboarding_circle_setup_solo_chosen')) > 0)                               as chose_a_setup_door,
    count(*) filter (where f.event in (
      'invite_share_opened',
      'invite_channel_chosen',
      'invite_code_copied'))                                                     as invite_sends_started
  from public.funnel_events f
  group by f.user_id
)
select
  a.user_id,
  p.name                                        as display_name,
  a.cohort_week,
  a.signed_up_at,
  (current_date - a.signup_date)                as account_age_days,

  -- ---- stage: account -> profile ------------------------------------
  -- users.name is the only record that the profile step finished and it
  -- carries no timestamp of its own; funnel_events supplies the timing
  -- from the day it ships forward, and is null for every account before.
  (p.name is not null)                          as has_profile_name,
  fe.profile_opened_at,
  fe.profile_saved_at,

  -- ---- stage: reminders ask ------------------------------------------
  fe.reminders_opened_at,
  p.reminders_ask_seen_at,

  -- ---- stage: account -> joined or started a circle -------------------
  fe.circle_setup_opened_at,
  fe.chose_a_setup_door,
  fj.first_joined_at,
  fj.first_join_source,
  coalesce(m.circles_joined, 0)                 as circles_joined,
  coalesce(m.joined_as_creator, 0)              as joined_as_creator,
  coalesce(m.joined_via_invite, 0)              as joined_via_invite,
  coalesce(m.joined_via_browse, 0)              as joined_via_browse,
  coalesce(m.memberships_finished, 0)           as memberships_finished,
  case when fj.first_joined_at is null then null
       else round(extract(epoch from (fj.first_joined_at - a.signed_up_at))::numeric / 86400.0, 2)
  end                                           as days_signup_to_first_join,

  -- ---- stage: signup -> first practice --------------------------------
  -- TF1 job 4a's stopwatch standard is "over ~2 minutes = a bug", and it
  -- was written for a WALKTHROUGH on a fresh account: the fastest possible
  -- path, measured deliberately. Applied backwards to real accounts it
  -- flags anyone who signed up in the evening and first practised the next
  -- morning, which is not a bug and not a person doing anything wrong. So
  -- the column is named for the threshold it compares against and nothing
  -- here calls it one. Read it as "these accounts did NOT take the fast
  -- path", then ask why for the ones you expected to.
  sc.first_self_checkin_at,
  case when sc.first_self_checkin_at is null then null
       else round(extract(epoch from (sc.first_self_checkin_at - a.signed_up_at))::numeric, 1)
  end                                           as seconds_signup_to_first_practice,
  case when sc.first_self_checkin_at is null then null
       else (sc.first_self_checkin_at - a.signed_up_at) > interval '2 minutes'
  end                                           as over_tf1_two_minute_mark,

  -- ---- stage: still here ----------------------------------------------
  -- "Alive at day N" = practised at least once on or after day N of their
  -- own signup, i.e. they got PAST that day rather than merely reaching
  -- it. NULL, never false, for an account too young to have had the
  -- chance — an unanswerable question is not a negative answer.
  case when (current_date - a.signup_date) < 7 then null else exists (
    select 1 from public.completions c
    where c.user_id = a.user_id and c.kind = 'self'
      and c.local_date >= a.signup_date + 7
  ) end                                         as alive_d7,
  case when (current_date - a.signup_date) < 21 then null else exists (
    select 1 from public.completions c
    where c.user_id = a.user_id and c.kind = 'self'
      and c.local_date >= a.signup_date + 21
  ) end                                         as alive_d21,
  sc.last_self_local_date,
  coalesce(sc.self_days_any_circle, 0)          as self_days_any_circle,

  -- ---- solo versus circle ---------------------------------------------
  -- Measured at QUERY TIME from current member counts, not at join time:
  -- a circle that grew from one member to three has no record of when it
  -- stopped being solo, so this says "has ever practised alongside anyone
  -- in a circle they are in now". NULL for an account with no membership.
  case when m.user_id is null then null
       when m.ever_had_company then 'circle'
       else 'solo'
  end                                           as company_kind,
  m.largest_circle_size,

  -- ---- the personal arc -------------------------------------------------
  coalesce(r.best_rally_count, 0)               as best_rally_count,
  coalesce(r.memberships_reaching_rally_21, 0)  as memberships_reaching_rally_21,
  coalesce(r.memberships_past_rally_21, 0)      as memberships_past_rally_21,

  -- ---- k-factor seed ----------------------------------------------------
  -- Sent side from funnel_events (null-as-zero before it shipped);
  -- accepted side is join_source='invite' on OTHER people's memberships,
  -- which is a cohort-level join and lives in the weekly rollup, not here.
  coalesce(fe.invite_sends_started, 0)          as invite_sends_started,

  -- ---- channel ----------------------------------------------------------
  (dt.user_id is not null)                      as has_device_token
from account a
left join public.users p on p.id = a.user_id
left join first_join fj  on fj.user_id = a.user_id
left join memb m         on m.user_id = a.user_id
left join selfc sc       on sc.user_id = a.user_id
left join rally r        on r.user_id = a.user_id
left join fe             on fe.user_id = a.user_id
left join (select distinct user_id from public.device_tokens) dt on dt.user_id = a.user_id;

comment on view analytics.funnel_person is
  'AN1 job 1 — one row per live account with every reconstructible funnel '
  'stage. Counts only; see the migration header for what is derived and '
  'what is genuinely unrecorded.';

-- ---------------------------------------------------------------------
-- analytics.funnel_weekly — the same lens rolled up by signup week.
-- This IS the weekly funnel query: keeping it as a view rather than a
-- pasted block means the dashboard SQL and the RPC can never drift.
-- ---------------------------------------------------------------------
create or replace view analytics.funnel_weekly as
select
  cohort_week,
  count(*)                                                          as accounts,

  -- onboarding
  count(*) filter (where has_profile_name)                          as with_profile_name,
  count(*) filter (where profile_opened_at is not null)             as profile_step_opened,
  count(*) filter (where circle_setup_opened_at is not null)        as circle_setup_opened,
  count(*) filter (where chose_a_setup_door)                        as chose_a_setup_door,
  count(*) filter (where reminders_ask_seen_at is not null)         as answered_reminders_ask,

  -- account -> circle, split by the door they came through
  count(*) filter (where first_joined_at is not null)               as joined_or_started,
  count(*) filter (where first_join_source = 'creator')             as first_join_creator,
  count(*) filter (where first_join_source = 'invite')              as first_join_invite,
  count(*) filter (where first_join_source = 'browse')              as first_join_browse,

  -- signup -> first practice, against TF1's stopwatch standard
  count(*) filter (where first_self_checkin_at is not null)         as practised_at_least_once,
  count(*) filter (where over_tf1_two_minute_mark is false)         as first_practice_within_2min,
  count(*) filter (where over_tf1_two_minute_mark is true)          as first_practice_over_2min,

  -- still here. The eligible counts are the denominators — an account too
  -- young to answer is excluded from both sides, never counted as a loss.
  count(*) filter (where alive_d7 is not null)                      as eligible_d7,
  count(*) filter (where alive_d7)                                  as alive_d7,
  count(*) filter (where alive_d21 is not null)                     as eligible_d21,
  count(*) filter (where alive_d21)                                 as alive_d21,

  -- solo versus circle
  count(*) filter (where company_kind = 'solo')                     as solo_accounts,
  count(*) filter (where company_kind = 'circle')                   as circle_accounts,
  count(*) filter (where company_kind = 'solo' and alive_d7)        as solo_alive_d7,
  count(*) filter (where company_kind = 'circle' and alive_d7)      as circle_alive_d7,
  count(*) filter (where company_kind = 'solo' and alive_d21)       as solo_alive_d21,
  count(*) filter (where company_kind = 'circle' and alive_d21)     as circle_alive_d21,

  -- the personal arc, in practices
  max(best_rally_count)                                             as best_rally_count_in_cohort,
  count(*) filter (where memberships_reaching_rally_21 > 0)         as reached_rally_21,
  count(*) filter (where memberships_past_rally_21 > 0)             as continued_past_rally_21,

  -- k-factor seed: sends started by this cohort, and joins ACCEPTED via an
  -- invite code by this cohort. The two sides belong to different people
  -- by definition, so this is a seed for the ratio, never the ratio.
  sum(invite_sends_started)                                         as invite_sends_started,
  sum(joined_via_invite)                                            as memberships_joined_via_invite,
  count(*) filter (where has_device_token)                          as with_device_token
from analytics.funnel_person
group by cohort_week;

comment on view analytics.funnel_weekly is
  'AN1 job 1 — funnel_person rolled up by signup week. The dashboard block '
  'in supabase/analytics/weekly-funnel.sql selects from this, so there is '
  'one source of truth for the numbers rather than two.';

-- ---------------------------------------------------------------------
-- The founder-gated door, for reading the lens from a session.
-- ---------------------------------------------------------------------
create or replace function public.founder_activation_funnel()
returns setof analytics.funnel_person
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  -- Same gate and same shape as MOD1's founder RPCs. The redirect on any
  -- client screen is a courtesy; this is the enforcement.
  if not public.is_founder() then
    raise exception 'founder only';
  end if;
  return query select * from analytics.funnel_person order by signed_up_at;
end;
$fn$;

comment on function public.founder_activation_funnel() is
  'AN1 job 1 — the per-person activation funnel, founder-gated. The weekly '
  'rollup is read from the dashboard (analytics.funnel_weekly), which needs '
  'no session.';

-- S1 convention: a new function emerges EXECUTE-able by PUBLIC (and so by
-- anon) from Postgres''s own built-in default, which no `alter default
-- privileges` can close from the role migrations connect as (HD2 job 4
-- proved this by applying the revoke and watching a grantless function
-- still emerge with =X/postgres). The explicit revoke below is therefore
-- the ONLY control, not a belt-and-braces nicety.
revoke all on function public.founder_activation_funnel() from public;
revoke all on function public.founder_activation_funnel() from anon;
grant execute on function public.founder_activation_funnel() to authenticated;
