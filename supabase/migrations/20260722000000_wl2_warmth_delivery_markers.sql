-- WL2 (21 July) — the warmth arrives: delivery surfaces for the
-- recipient-private heart/wave rows WL1 created.
--
-- Two seen-markers and two small functions:
-- 1. users.warmth_seen_at — one marker shared by the Today whisper and
--    the check-in echo: whichever surface renders fresh warmth first
--    consumes it (sets the marker), so warmth is whispered once and
--    never re-renders stale. NOT NULL DEFAULT now(): existing users
--    start at migration time, so WL1's historic warmth rows (which
--    already appeared publicly on the wall in their day) never flood
--    the first whisper; a new user starts at signup and can only ever
--    see warmth that arrived after.
-- 2. memberships.wall_seen_at — per-circle last-wall-visit marker for
--    Today's wall teaser. NULL means never visited: everything on the
--    wall is newer than a visit that never happened, so the teaser
--    shows (the spec's explicit never-visited case).
-- 3. get_my_fresh_warmth() — the whisper/echo read. SECURITY DEFINER,
--    keyed strictly on auth.uid(): recipient-only by construction, and
--    the seen-gate applies SERVER-side so stale warmth never crosses
--    the API (the GS1 pattern). Sender names resolve here (left join)
--    so warmth from a circle the sender has since left still reads
--    warmly instead of failing an RLS embed.
-- 4. mark_wall_seen(p_circle_id) — stamps the caller's own membership
--    row on wall open (memberships has no client UPDATE policy by
--    design; the SC3 mark_wrapped_offered pattern).

alter table public.users
  add column warmth_seen_at timestamptz not null default now();

alter table public.memberships
  add column wall_seen_at timestamptz;

create function public.get_my_fresh_warmth()
returns table(kind text, sender_name text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select
    wm.kind,
    coalesce(u.name, 'a circle-mate') as sender_name,
    wm.created_at
  from public.wall_messages wm
  left join public.users u on u.id = wm.user_id
  where wm.recipient_id = auth.uid()
    and wm.kind in ('wave', 'heart')
    -- the same read guards the WL1 SELECT policy applies: moderation-
    -- hidden warmth stays hidden, and a blocked sender's warmth never
    -- reaches the whisper either.
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

create function public.mark_wall_seen(p_circle_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.memberships
  set wall_seen_at = now()
  where circle_id = p_circle_id and user_id = auth.uid();
$$;

revoke all on function public.mark_wall_seen(uuid) from public;
revoke all on function public.mark_wall_seen(uuid) from anon;
grant execute on function public.mark_wall_seen(uuid) to authenticated;
