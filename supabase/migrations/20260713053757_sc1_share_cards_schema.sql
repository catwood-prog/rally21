-- SC1 (13 July) — share cards phase 1a: card slot + curated quote flavor.
-- Spec: ../Rally21-Share-Cards-Spec.md. Only flavor 4.1 (curated_quote,
-- including the NF-* facts sub-flavor) ships this pass — 4.2/4.3 are
-- SC2/SC3. S1/G5 conventions throughout: explicit revokes (this
-- project's actual default ACL grants EXECUTE to anon/PUBLIC on new
-- functions), pinned search_path, no privileged data trusted from the
-- client beyond structured non-sensitive signals.

create table public.share_card_bank (
  id text primary key, -- matches the bank file's own IDs (QB-001, NF-01, ...)
  flavor text not null default 'curated_quote' check (flavor in ('curated_quote')),
  body text not null,
  -- null AND the literal string 'Unknown' both mean "no author line" at
  -- render time (spec §4.1) — 'Unknown' is kept distinct from null so the
  -- bank file's own real-but-untraceable-author bookkeeping survives in
  -- the data; NF-* fact rows (no author concept at all) use null directly.
  attribution text,
  source_note text not null,
  theme text not null,
  extra_tags text[] not null default '{}',
  moment text not null default 'any',
  gloss text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.share_card_bank enable row level security;

create policy "any signed-in user can read the active bank"
  on public.share_card_bank
  for select
  to authenticated
  using (active = true);

revoke all on public.share_card_bank from anon, public;
grant select on public.share_card_bank to authenticated;

create table public.user_card_prefs (
  user_id uuid primary key references public.users(id) on delete cascade,
  muted_flavors text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.user_card_prefs enable row level security;

create policy "a user can read their own card prefs"
  on public.user_card_prefs
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "a user can insert their own card prefs"
  on public.user_card_prefs
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "a user can update their own card prefs"
  on public.user_card_prefs
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.user_card_prefs from anon, public;
grant select, insert, update on public.user_card_prefs to authenticated;

create table public.card_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  flavor text not null,
  card_key text not null,
  event text not null check (
    event in ('shown', 'opened', 'shared', 'saved', 'dismissed', 'muted', 'liked', 'passed')
  ),
  created_at timestamptz not null default now()
);

create index card_events_user_created_idx on public.card_events (user_id, created_at desc);
create index card_events_user_card_idx on public.card_events (user_id, card_key);

alter table public.card_events enable row level security;

create policy "a user can insert their own card events"
  on public.card_events
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- Reads are founder-only (the tuning dashboard is a founder surface, same
-- allowlist pattern as app_caps/is_founder) — never a user reading their
-- own event history back, since nothing in the app needs that today.
create policy "founder can read all card events"
  on public.card_events
  for select
  to authenticated
  using (is_founder());

revoke all on public.card_events from anon, public;
grant select, insert on public.card_events to authenticated;

-- Owner-scoped mute toggle. Muting is instant/silent/permanent until the
-- user re-enables in settings — no confirmation, no trace beyond the pref
-- row itself (spec §2.3).
create or replace function public.set_card_flavor_muted(p_flavor text, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_card_prefs (user_id, muted_flavors)
  values (
    auth.uid(),
    case when p_muted then array[p_flavor] else '{}'::text[] end
  )
  on conflict (user_id) do update set
    muted_flavors = case
      when p_muted then array(select distinct unnest(public.user_card_prefs.muted_flavors || array[p_flavor]))
      else array(select unnest(public.user_card_prefs.muted_flavors) except select p_flavor)
    end;
end;
$$;

revoke all on function public.set_card_flavor_muted(text, boolean) from public;
revoke all on function public.set_card_flavor_muted(text, boolean) from anon;
grant execute on function public.set_card_flavor_muted(text, boolean) to authenticated;

create or replace function public.get_my_card_prefs()
returns table (muted_flavors text[])
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.muted_flavors from public.user_card_prefs p where p.user_id = auth.uid()),
    '{}'::text[]
  );
$$;

revoke all on function public.get_my_card_prefs() from public;
revoke all on function public.get_my_card_prefs() from anon;
grant execute on function public.get_my_card_prefs() to authenticated;

create or replace function public.record_card_event(p_flavor text, p_card_key text, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event not in ('shown', 'opened', 'shared', 'saved', 'dismissed', 'muted', 'liked', 'passed') then
    raise exception 'invalid card event';
  end if;
  insert into public.card_events (user_id, flavor, card_key, event)
  values (auth.uid(), p_flavor, p_card_key, p_event);
end;
$$;

revoke all on function public.record_card_event(text, text, text) from public;
revoke all on function public.record_card_event(text, text, text) from anon;
grant execute on function public.record_card_event(text, text, text) to authenticated;

-- The slot's own cadence + selection RPC. Privacy floor (spec §2.2): reads
-- ONLY structured state — completions/glow (via the existing
-- get_glow_for_user), and reflections.mood as a NUMBER for the trend
-- average, never line1/line2/question_answer (grep-provable: this
-- function's body contains no reference to those columns). p_is_rekindle
-- and p_is_covered are instance-specific to THIS check-in and passed by
-- the caller, which already computed them for its own existing logic
-- (mirrors the p_local_date pattern used throughout this project — the
-- server can't know a client-instant fact any other way).
create or replace function public.get_share_card_for_today(
  p_local_date date,
  p_is_rekindle boolean default false,
  p_is_covered boolean default false
)
returns table (
  card_key text,
  body text,
  attribution text,
  gloss text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_iso_week text := to_char(p_local_date, 'IYYY-IW');
  v_dow int := extract(dow from p_local_date)::int;
  v_pair_idx bigint;
  v_is_scheduled_day boolean := false;
  v_shown_yesterday boolean;
  v_shown_this_week_count int;
  v_muted_flavors text[];
  v_ember_state text;
  v_mood_avg numeric;
  v_exclusion_days int := 45;
begin
  -- Deterministic per-user-per-week schedule: md5(user_id || iso_week)
  -- picks one of the 14 non-adjacent (circularly, so Sat/Sun don't count
  -- as adjacent either) weekday pairs out of 7 days — stable for repeat
  -- requests the same user+week, satisfies "at most 2/week."
  v_pair_idx := ('x' || substr(md5(auth.uid()::text || v_iso_week), 1, 8))::bit(32)::bigint % 14;

  select true into v_is_scheduled_day
  from (values
    (0,0,2),(1,0,3),(2,0,4),(3,0,5),(4,1,3),(5,1,4),(6,1,5),
    (7,1,6),(8,2,4),(9,2,5),(10,2,6),(11,3,5),(12,3,6),(13,4,6)
  ) as pairs(idx, d1, d2)
  where pairs.idx = v_pair_idx and v_dow in (pairs.d1, pairs.d2);

  if not coalesce(v_is_scheduled_day, false) then
    return;
  end if;

  -- "Never two days running" — the pair-schedule alone can't catch a
  -- cross-week-boundary adjacency (e.g. this week picks Saturday, next
  -- week independently picks Sunday), so this is a real, separate check,
  -- not a redundant one.
  select exists (
    select 1 from public.card_events
    where user_id = auth.uid() and event = 'shown' and created_at::date = p_local_date - 1
  ) into v_shown_yesterday;
  if v_shown_yesterday then
    return;
  end if;

  select count(*) into v_shown_this_week_count
  from public.card_events
  where user_id = auth.uid() and event = 'shown'
    and to_char(created_at::date, 'IYYY-IW') = v_iso_week;
  if v_shown_this_week_count >= 2 then
    return;
  end if;

  select muted_flavors into v_muted_flavors from public.user_card_prefs where user_id = auth.uid();
  if 'curated_quote' = any(coalesce(v_muted_flavors, '{}')) then
    return;
  end if;

  select state into v_ember_state from public.get_glow_for_user(auth.uid());

  select avg(mood) into v_mood_avg
  from public.reflections
  where user_id = auth.uid() and local_date > p_local_date - 7 and local_date <= p_local_date and mood is not null;

  return query
  with scored as (
    select
      b.id,
      b.body,
      b.attribution,
      b.gloss,
      1.0
        + (case when p_is_rekindle and b.theme = 'returning & beginning again' then 3 else 0 end)
        + (case when v_ember_state = 'embers' and b.theme = 'rest & gentleness' then 2 else 0 end)
        + (case when p_is_covered and b.theme = 'friendship & carrying each other' then 3 else 0 end)
        + (case when v_mood_avg is not null and v_mood_avg <= 2.5 and b.theme = 'rest & gentleness' then 2 else 0 end)
        - (case when v_mood_avg is not null and v_mood_avg <= 2.5 and b.theme = 'endurance & the long walk' then 1 else 0 end)
        + coalesce((
            select count(*)::numeric from public.card_events e
            where e.user_id = auth.uid() and e.card_key = b.id and e.event = 'liked'
          ), 0)
        - coalesce((
            select count(*)::numeric * 0.5 from public.card_events e
            where e.user_id = auth.uid() and e.card_key = b.id and e.event = 'passed'
          ), 0)
        as score
    from public.share_card_bank b
    where b.active = true and b.flavor = 'curated_quote'
      and b.id not in (
        select e.card_key from public.card_events e
        where e.user_id = auth.uid() and e.event = 'shown'
          and e.created_at > (p_local_date - v_exclusion_days)::timestamptz
      )
  ),
  fallback as (
    -- Relaxation ladder (Q1-style): if the exclusion window emptied the
    -- pool, widen it in two steps rather than ever showing literally
    -- nothing due to a data-availability accident.
    select * from scored
    union all
    select b.id, b.body, b.attribution, b.gloss, 1.0
    from public.share_card_bank b
    where not exists (select 1 from scored)
      and b.active = true and b.flavor = 'curated_quote'
      and b.id not in (
        select e.card_key from public.card_events e
        where e.user_id = auth.uid() and e.event = 'shown'
          and e.created_at > (p_local_date - 14)::timestamptz
      )
    union all
    select b.id, b.body, b.attribution, b.gloss, 1.0
    from public.share_card_bank b
    where not exists (select 1 from scored)
      and not exists (
        select 1 from public.share_card_bank b2
        where b2.active = true and b2.flavor = 'curated_quote'
          and b2.id not in (
            select e.card_key from public.card_events e
            where e.user_id = auth.uid() and e.event = 'shown'
              and e.created_at > (p_local_date - 14)::timestamptz
          )
      )
      and b.active = true and b.flavor = 'curated_quote'
  )
  select f.id, f.body, f.attribution, f.gloss
  from fallback f
  order by f.score desc, md5(auth.uid()::text || f.id || p_local_date::text)
  limit 1;
end;
$$;

revoke all on function public.get_share_card_for_today(date, boolean, boolean) from public;
revoke all on function public.get_share_card_for_today(date, boolean, boolean) from anon;
grant execute on function public.get_share_card_for_today(date, boolean, boolean) to authenticated;
