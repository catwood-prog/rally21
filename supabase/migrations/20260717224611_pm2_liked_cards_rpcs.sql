-- PM2 (17 July) — liked quotes join the private map: the two RPCs.
-- Cat's ruling (17 July, after the PM2 investigation found card_events
-- reads are FOUNDER-ONLY by deliberate SC1 design): option 2 — a scoped
-- SECURITY DEFINER read RPC, NO policy widening; un-like ships in the same
-- pass as its own RPC doing a REAL row deletion of the caller's own liked
-- rows (never a tombstone), so NQ2's like-count (the nudge composer counts
-- 'liked' rows) respects un-likes automatically. Both functions carry the
-- S1/G5 hygiene: search_path pinned, explicit anon/PUBLIC revokes before
-- the authenticated grant. card_events' own policies are untouched
-- (INSERT own rows / SELECT founder-only; still no DELETE policy — the
-- delete below runs as definer, scoped to auth.uid() in the WHERE).

-- The private map's read: the caller's own Liked quotes, deduped by card
-- (latest like wins the timestamp), joined to the active bank for the
-- text/author, most recent first. Only the liked subset ever leaves the
-- table — shown/dismissed/passed history stays founder-only.
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
  group by b.id, b.body, b.attribution
  order by max(e.created_at) desc;
$$;

revoke all on function public.get_my_liked_cards() from public;
revoke all on function public.get_my_liked_cards() from anon;
grant execute on function public.get_my_liked_cards() to authenticated;

-- Un-like: delete ALL of the caller's own 'liked' rows for the card (a
-- card re-shown weeks later can be liked twice — un-like means "this
-- quote is no longer mine", so every duplicate goes). Scoped to
-- auth.uid() and event = 'liked' in the WHERE — no other user's rows and
-- no other event kind are reachable through this function.
create or replace function public.unlike_card(p_card_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.card_events
  where user_id = auth.uid()
    and event = 'liked'
    and card_key = p_card_key;
end;
$$;

revoke all on function public.unlike_card(text) from public;
revoke all on function public.unlike_card(text) from anon;
grant execute on function public.unlike_card(text) to authenticated;
