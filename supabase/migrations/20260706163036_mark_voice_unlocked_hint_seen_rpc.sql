-- Narrow RPC for the wall's one-time "7 days in — your voice is welcome
-- on the wall" hint: flips only has_seen_voice_unlocked_hint on the
-- caller's own membership row. Deliberately not a general membership
-- UPDATE RLS policy — memberships.role has an 'owner' value and an
-- open self-update policy would let a member self-promote.
create or replace function public.mark_voice_unlocked_hint_seen(p_circle_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.memberships
  set has_seen_voice_unlocked_hint = true
  where circle_id = p_circle_id and user_id = auth.uid();
$$;

revoke all on function public.mark_voice_unlocked_hint_seen(uuid) from public, anon;
grant execute on function public.mark_voice_unlocked_hint_seen(uuid) to authenticated;
