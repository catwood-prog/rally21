-- AU1 job 3b/3c (3 Aug, Cat's ruling) — the notification spot learns WHO
-- sent each moment, not just what they are called.
--
-- WHY. The spot's new look gives each sender their own white inner card
-- with their avatar. AV1 (Cat, 20 July) is explicit that there is no
-- initials fallback anywhere: a photo-less member is always their
-- penguin, and every avatar surface renders through the one shared
-- components/Avatar.tsx, which needs a USER ID (the penguin variant is
-- deterministic on hash(user id)) and an avatar url. Both of these
-- functions returned a display name and nothing else, so the spot could
-- only have drawn initials — the one avatar shape AV1 deleted.
--
-- The second reason is aggregation. Job 3c merges every moment from one
-- person into one card. Keyed on a NAME, two circle-mates who happen to
-- share a display name merge into a single card attributing one
-- person's wave to the other. Keyed on the user id it cannot happen.
--
-- WHAT IS NEWLY EXPOSED, and to whom. Only to the recipient, and only
-- about someone who deliberately sent THEM a gesture: that person's user
-- id and avatar url. Both are already returned to this same reader by
-- getCircleMembers for anyone they share a circle with, so the only new
-- case is a sender who has since LEFT the circle — WL2 deliberately
-- keeps their warmth readable ("a circle-mate" rather than a failed
-- embed), and they are now shown with the avatar they had when they sent
-- it. No new table, no new column, both functions stay read-only, and
-- the seen-gate, the block check and the moderation filter are all
-- carried through unchanged.
--
-- Return types change, so these are drop + create rather than replace.

drop function if exists public.get_my_fresh_warmth();

create function public.get_my_fresh_warmth()
returns table(
  kind text,
  sender_id uuid,
  sender_name text,
  sender_avatar_url text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    wm.kind,
    wm.user_id as sender_id,
    coalesce(u.name, 'a circle-mate') as sender_name,
    u.avatar_url as sender_avatar_url,
    wm.created_at
  from public.wall_messages wm
  left join public.users u on u.id = wm.user_id
  where wm.recipient_id = auth.uid()
    and wm.kind in ('wave', 'heart')
    -- the same read guards the WL1 SELECT policy applies: moderation-
    -- hidden warmth stays hidden, and a blocked sender's warmth never
    -- reaches the spot either.
    and not wm.hidden
    and not exists (
      select 1 from public.blocks b
      where b.blocker_id = auth.uid() and b.blocked_id = wm.user_id
    )
    and wm.created_at > (select warmth_seen_at from public.users where id = auth.uid())
  order by wm.created_at desc
$$;

-- S1/G5 convention: the project default ACL still grants EXECUTE to
-- anon/PUBLIC on new functions — revoke explicitly, then grant.
revoke all on function public.get_my_fresh_warmth() from public;
revoke all on function public.get_my_fresh_warmth() from anon;
grant execute on function public.get_my_fresh_warmth() to authenticated;

drop function if exists public.get_my_fresh_pebble_gifts();

create function public.get_my_fresh_pebble_gifts()
returns table(
  sender_id uuid,
  sender_name text,
  sender_avatar_url text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    g.from_user as sender_id,
    coalesce(u.name, 'someone in your circle') as sender_name,
    u.avatar_url as sender_avatar_url,
    g.created_at
  from public.pebble_gifts g
  join public.users u on u.id = g.from_user
  where g.to_user = auth.uid()
    and g.created_at > coalesce(
      (select w.warmth_seen_at from public.users w where w.id = auth.uid()),
      '-infinity'::timestamptz
    )
  order by g.created_at desc;
$$;

revoke all on function public.get_my_fresh_pebble_gifts() from public;
revoke all on function public.get_my_fresh_pebble_gifts() from anon;
grant execute on function public.get_my_fresh_pebble_gifts() to authenticated, service_role;
