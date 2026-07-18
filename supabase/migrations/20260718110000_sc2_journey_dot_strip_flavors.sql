-- SC2 (18 July) — share cards phase 1b: the warm journey line (spec §4.2)
-- and the dot strip (spec §4.3) join SC1's card slot. Rides SC1's shipped
-- machinery — same bank table, same cadence RPC, same card_events spine —
-- no parallel plumbing. S1/G5 conventions throughout: explicit
-- anon/PUBLIC revokes, pinned search_path.
--
-- Three pieces:
--   1. share_card_bank's flavor constraint grows to the three shipped
--      flavors, and ~a dozen warm_journey template rows are seeded
--      (tier 'original_unattributed' — Rally's own voice, like AN-*).
--      Bodies carry {slot} placeholders the CLIENT fills (day number,
--      times shown up, practice noun via the practice-accent machinery)
--      — the server picks the template, the client knows the circle
--      facts (the p_is_rekindle pattern: instance facts ride params).
--   2. get_share_card_for_today v2: same cadence gates verbatim, then a
--      deterministic seeded FLAVOR pick over the caller's unmuted,
--      eligible flavors — base weights 0.5 quote / 0.3 journey /
--      0.2 dot strip, renormalized over whatever is eligible (stated
--      per the SC2 section; Cat retunes by feel). Adds p_journey_day +
--      p_times_shown params (defaults null, so SC1-era cached clients
--      calling with three args keep working and simply stay
--      quotes-only). Returns a new leading `flavor` column.
--   3. get_my_liked_cards narrows to flavor = 'curated_quote': the
--      private map's section is "quotes you love", and a liked journey
--      TEMPLATE row would otherwise surface with raw {slot} text.
--      (compose-nudges' loved-line pick needs the same gate — that's an
--      edge-function change shipped alongside this migration.)

alter table public.share_card_bank
  drop constraint share_card_bank_flavor_check;
alter table public.share_card_bank
  add constraint share_card_bank_flavor_check
  check (flavor in ('curated_quote', 'warm_journey', 'dot_strip'));

-- The journey template bank (spec §4.2). Present-positive ONLY — no
-- template may reference a miss (warmth law; the unit test audits these
-- exact rows by reading this file). Slots, filled client-side:
--   {day}          the circle's journey day number (digits)
--   {count}        own self check-ins in this circle (digits)
--   {countWord}    the same count as a number word
--   {practiceNoun} the practice-accent noun ("meditation", "writing";
--                  falls back to "practice" for any unrecognized name)
-- moment gates which days a template may serve:
--   any | early (journey day <= 7) | arc (day >= 8) | covered (only on
--   a day a friend held — and then strongly boosted, per the spec's own
--   covered-day example).
-- extra_tags 'needs_count' excludes the row when the client couldn't
-- supply a count of at least 2 (so "{countWord} times" can never render
-- as "one times").
insert into public.share_card_bank (id, flavor, body, attribution, source_note, theme, extra_tags, moment, gloss, tier) values
  ('WJ-01', 'warm_journey', E'You’ve kept a promise to yourself {countWord} times.', null, 'SC2 journey template; slots: countWord; the spec §4.2 flagship example, count-true by construction', 'journey', '{needs_count}', 'any', null, 'original_unattributed'),
  ('WJ-02', 'warm_journey', 'One small thing, done again today.', null, 'SC2 journey template; slots: none', 'journey', '{}', 'any', null, 'original_unattributed'),
  ('WJ-03', 'warm_journey', 'Every long practice looks exactly like this at the start.', null, 'SC2 journey template; slots: none', 'journey', '{}', 'early', null, 'original_unattributed'),
  ('WJ-04', 'warm_journey', 'Quietly, this is becoming part of who you are.', null, 'SC2 journey template; slots: none', 'journey', '{}', 'arc', null, 'original_unattributed'),
  ('WJ-05', 'warm_journey', E'You showed up today. That’s the whole secret.', null, 'SC2 journey template; slots: none', 'journey', '{}', 'any', null, 'original_unattributed'),
  ('WJ-06', 'warm_journey', E'That’s {countWord} times you’ve shown up for this.', null, 'SC2 journey template; slots: countWord', 'journey', '{needs_count}', 'arc', null, 'original_unattributed'),
  ('WJ-07', 'warm_journey', 'Done for today. Tomorrow can take care of itself.', null, 'SC2 journey template; slots: none', 'journey', '{}', 'any', null, 'original_unattributed'),
  ('WJ-08', 'warm_journey', E'A friend held your place today. That’s the whole idea.', null, 'SC2 journey template; slots: none; the spec §4.2 covered-day line, only served (and boosted) on a held day', 'journey', '{}', 'covered', null, 'original_unattributed'),
  ('WJ-09', 'warm_journey', 'Coming back to your {practiceNoun}, day after day.', null, 'SC2 journey template; slots: practiceNoun (practice-accent noun, falls back to "practice")', 'journey', '{}', 'any', null, 'original_unattributed'),
  ('WJ-10', 'warm_journey', 'Day {day} is built out of every day before it.', null, 'SC2 journey template; slots: day', 'journey', '{}', 'arc', null, 'original_unattributed'),
  ('WJ-11', 'warm_journey', 'The first week is the steepest part. Look at you, climbing.', null, 'SC2 journey template; slots: none', 'journey', '{}', 'early', null, 'original_unattributed'),
  ('WJ-12', 'warm_journey', 'Nobody sees most of this. You did it anyway.', null, 'SC2 journey template; slots: none', 'journey', '{}', 'any', null, 'original_unattributed'),
  ('WJ-13', 'warm_journey', 'This is what a rhythm feels like.', null, 'SC2 journey template; slots: none', 'journey', '{}', 'arc', null, 'original_unattributed');

-- The dot strip needs no bank rows: its content IS the caller's week
-- (G5's get_my_week, rendered client-side, exactly as in-app) plus a
-- line the client composes under the name-consent toggle (Cat's 17 July
-- ruling on spec §9 Q3). Its card_key is synthesized per ISO week
-- ('DS-IYYY-IW'), which doubles as its dedupe: the same week's strip is
-- the same card, so a week that already showed one is excluded.

-- ---------------------------------------------------------------------
-- get_share_card_for_today v2. The 3-arg SC1 signature is dropped (a
-- surviving copy would make 3-named-arg calls ambiguous); old clients'
-- 3-arg calls resolve to this function via the two new defaults.
drop function public.get_share_card_for_today(date, boolean, boolean);

create or replace function public.get_share_card_for_today(
  p_local_date date,
  p_is_rekindle boolean default false,
  p_is_covered boolean default false,
  p_journey_day int default null,
  p_times_shown int default null
)
returns table (
  flavor text,
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
  -- SC2 flavor rotation
  v_w_quote numeric := 0;
  v_w_journey numeric := 0;
  v_w_dot numeric := 0;
  v_w_total numeric;
  v_u numeric;
  v_flavor text;
  v_ds_key text;
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
    select 1 from public.card_events e
    where e.user_id = auth.uid() and e.event = 'shown' and e.created_at::date = p_local_date - 1
  ) into v_shown_yesterday;
  if v_shown_yesterday then
    return;
  end if;

  select count(*) into v_shown_this_week_count
  from public.card_events e
  where e.user_id = auth.uid() and e.event = 'shown'
    and to_char(e.created_at::date, 'IYYY-IW') = v_iso_week;
  if v_shown_this_week_count >= 2 then
    return;
  end if;

  select p.muted_flavors into v_muted_flavors from public.user_card_prefs p where p.user_id = auth.uid();
  v_muted_flavors := coalesce(v_muted_flavors, '{}');

  -- SC2 — which flavor gets today's slot. Base weights 0.5 / 0.3 / 0.2
  -- (quotes stay the everyday lead per spec §1's low-ego-cost thesis;
  -- the dot strip trails slightly since it also self-dedupes to once
  -- per week), renormalized over the eligible set. A muted flavor's
  -- weight is zero, full stop — mute is the only zero (spec §3). The
  -- spec's adaptive per-user flavor weighting (share bumps, dismiss
  -- lowers) is deliberately NOT built yet — static weights Cat can
  -- retune are the SC2 section's ask; adaptivity stays future work.
  if not ('curated_quote' = any(v_muted_flavors)) then
    v_w_quote := 0.5;
  end if;

  -- Journey lines need the client-known journey day (older cached
  -- clients don't send it — they simply stay quotes-only), and at least
  -- one template whose gates pass today.
  if not ('warm_journey' = any(v_muted_flavors)) and p_journey_day is not null then
    if exists (
      select 1 from public.share_card_bank b
      where b.active = true and b.flavor = 'warm_journey'
        and (b.moment = 'any'
             or (b.moment = 'early' and p_journey_day <= 7)
             or (b.moment = 'arc' and p_journey_day >= 8)
             or (b.moment = 'covered' and p_is_covered))
        and (not ('needs_count' = any(b.extra_tags)) or coalesce(p_times_shown, 0) >= 2)
    ) then
      v_w_journey := 0.3;
    end if;
  end if;

  -- The dot strip: one per ISO week by construction (same week = same
  -- card), keyed so the shown-event record is the dedupe.
  v_ds_key := 'DS-' || v_iso_week;
  if not ('dot_strip' = any(v_muted_flavors)) and p_journey_day is not null then
    if not exists (
      select 1 from public.card_events e
      where e.user_id = auth.uid() and e.event = 'shown' and e.card_key = v_ds_key
    ) then
      v_w_dot := 0.2;
    end if;
  end if;

  v_w_total := v_w_quote + v_w_journey + v_w_dot;
  if v_w_total = 0 then
    return;
  end if;

  -- Seeded uniform pick — its own salt ('flavor') keeps it independent
  -- of the pair-schedule hash above (the NQ2 lesson: two picks sharing
  -- a seed suffix are affinely related, not independent). The bit(32)
  -- cast is unsigned (proven live: x'ffffffff' -> 4294967295).
  v_u := ('x' || substr(md5(auth.uid()::text || p_local_date::text || 'flavor'), 1, 8))::bit(32)::bigint::numeric
         / 4294967296.0 * v_w_total;
  if v_u < v_w_quote then
    v_flavor := 'curated_quote';
  elsif v_u < v_w_quote + v_w_journey then
    v_flavor := 'warm_journey';
  else
    v_flavor := 'dot_strip';
  end if;

  if v_flavor = 'dot_strip' then
    -- Content is client-rendered (the real week via get_my_week + the
    -- consent-toggled line) — the RPC only awards the slot and the key.
    return query select 'dot_strip'::text, v_ds_key, ''::text, null::text, null::text;
    return;
  end if;

  if v_flavor = 'warm_journey' then
    return query
    with gated as (
      select
        b.id,
        b.body,
        1.0
          -- The covered-day line is the point of a covered day (spec
          -- §4.2's own example) — boosted past any like-count so it
          -- wins whenever it's eligible at all.
          + (case when p_is_covered and b.moment = 'covered' then 5 else 0 end)
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
      where b.active = true and b.flavor = 'warm_journey'
        and (b.moment = 'any'
             or (b.moment = 'early' and p_journey_day <= 7)
             or (b.moment = 'arc' and p_journey_day >= 8)
             or (b.moment = 'covered' and p_is_covered))
        and (not ('needs_count' = any(b.extra_tags)) or coalesce(p_times_shown, 0) >= 2)
    ),
    scored as (
      select g.id, g.body, g.score from gated g
      where g.id not in (
        select e.card_key from public.card_events e
        where e.user_id = auth.uid() and e.event = 'shown'
          and e.created_at > (p_local_date - v_exclusion_days)::timestamptz
      )
    ),
    fallback as (
      -- Same relaxation ladder as the quote branch: 45-day exclusion,
      -- then 14, then none — never literally nothing from a
      -- data-availability accident.
      select * from scored
      union all
      select g.id, g.body, g.score from gated g
      where not exists (select 1 from scored)
        and g.id not in (
          select e.card_key from public.card_events e
          where e.user_id = auth.uid() and e.event = 'shown'
            and e.created_at > (p_local_date - 14)::timestamptz
        )
      union all
      select g.id, g.body, g.score from gated g
      where not exists (select 1 from scored)
        and not exists (
          select 1 from gated g2
          where g2.id not in (
            select e.card_key from public.card_events e
            where e.user_id = auth.uid() and e.event = 'shown'
              and e.created_at > (p_local_date - 14)::timestamptz
          )
        )
    )
    select 'warm_journey'::text, f.id, f.body, null::text, null::text
    from fallback f
    order by f.score desc, md5(auth.uid()::text || f.id || p_local_date::text)
    limit 1;
    return;
  end if;

  -- curated_quote — SC1's selection, verbatim, with the flavor column
  -- prepended. Privacy floor unchanged (spec §2.2): structured state
  -- only, mood strictly as a number, never line1/line2/question_answer.
  select gl.state into v_ember_state from public.get_glow_for_user(auth.uid()) gl;

  select avg(r.mood) into v_mood_avg
  from public.reflections r
  where r.user_id = auth.uid() and r.local_date > p_local_date - 7 and r.local_date <= p_local_date and r.mood is not null;

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
  select 'curated_quote'::text, f.id, f.body, f.attribution, f.gloss
  from fallback f
  order by f.score desc, md5(auth.uid()::text || f.id || p_local_date::text)
  limit 1;
end;
$$;

revoke all on function public.get_share_card_for_today(date, boolean, boolean, int, int) from public;
revoke all on function public.get_share_card_for_today(date, boolean, boolean, int, int) from anon;
grant execute on function public.get_share_card_for_today(date, boolean, boolean, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- PM2's private-map read narrows to actual quotes: "quotes you love"
-- must never serve a journey TEMPLATE (raw {slot} text) just because
-- the user liked its card. Body otherwise identical to the PM2 version.
create or replace function public.get_my_liked_cards()
returns table (
  card_key text,
  body text,
  attribution text,
  liked_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id as card_key,
    b.body,
    b.attribution,
    max(e.created_at) as liked_at
  from public.card_events e
  join public.share_card_bank b on b.id = e.card_key
  where e.user_id = auth.uid()
    and e.event = 'liked'
    and b.active = true
    and b.flavor = 'curated_quote'
  group by b.id, b.body, b.attribution
  order by max(e.created_at) desc;
$$;

revoke all on function public.get_my_liked_cards() from public;
revoke all on function public.get_my_liked_cards() from anon;
grant execute on function public.get_my_liked_cards() to authenticated;
