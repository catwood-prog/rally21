import { supabase } from './supabase';

// SC1 (13 July) — share cards phase 1a: card slot + curated quote flavor.
// Spec: ../Rally21-Share-Cards-Spec.md. Only flavor 4.1 (curated_quote,
// including the NF-* facts sub-flavor) ships this pass.

export type ShareCardFlavor = 'curated_quote';

export type ShareCard = {
  cardKey: string;
  body: string;
  attribution: string | null;
  gloss: string | null;
};

export type CardEvent = 'shown' | 'opened' | 'shared' | 'saved' | 'dismissed' | 'muted' | 'liked' | 'passed';

/** The composition rule (spec §3): ceremony > milestone (G3) > glow beat
 * (G5) > card > plain "Nice." A card only ever appears when nothing above
 * it fired — mirrors shouldShowGlowBeat's own precedence pattern exactly. */
export function shouldOfferShareCard(params: {
  isCeremonyDay: boolean;
  hasMilestone: boolean;
  showsGlowBeat: boolean;
}): boolean {
  if (params.isCeremonyDay) return false;
  if (params.hasMilestone) return false;
  if (params.showsGlowBeat) return false;
  return true;
}

/** Read-only, stable — safe to call speculatively; only calling
 * recordCardEvent('shown', ...) actually consumes the day's cadence slot.
 * Returns null when no card is scheduled/eligible today (muted flavor,
 * cadence not due, shown yesterday, weekly cap hit). */
export async function getShareCardForToday(params: {
  localDate: string;
  isRekindle?: boolean;
  isCovered?: boolean;
}): Promise<ShareCard | null> {
  const { data, error } = await supabase.rpc('get_share_card_for_today', {
    p_local_date: params.localDate,
    p_is_rekindle: params.isRekindle ?? false,
    p_is_covered: params.isCovered ?? false,
  });
  if (error) throw error;
  const row = (data as { card_key: string; body: string; attribution: string | null; gloss: string | null }[])?.[0];
  if (!row) return null;
  return { cardKey: row.card_key, body: row.body, attribution: row.attribution, gloss: row.gloss };
}

export async function recordCardEvent(
  flavor: ShareCardFlavor,
  cardKey: string,
  event: CardEvent
): Promise<void> {
  const { error } = await supabase.rpc('record_card_event', {
    p_flavor: flavor,
    p_card_key: cardKey,
    p_event: event,
  });
  if (error) throw error;
}

// PM2 (17 July) — the private map's "quotes you love" section. Reads ride
// get_my_liked_cards (SECURITY DEFINER — card_events' own SELECT stays
// founder-only, Cat's ruling: scoped RPC, no policy widening); un-like is
// unlike_card, a REAL deletion of the caller's own liked rows (never a
// tombstone) so NQ2's nudge like-count respects it automatically.

export type LikedCard = {
  cardKey: string;
  body: string;
  attribution: string | null;
  likedAt: string;
};

/** The caller's own Liked quotes — deduped by card (latest like wins the
 * timestamp), joined to the active bank, most recent first (all done by
 * the RPC). */
export async function getMyLikedCards(): Promise<LikedCard[]> {
  const { data, error } = await supabase.rpc('get_my_liked_cards');
  if (error) throw error;
  const rows = (data ?? []) as { card_key: string; body: string; attribution: string | null; liked_at: string }[];
  return rows.map((r) => ({ cardKey: r.card_key, body: r.body, attribution: r.attribution, likedAt: r.liked_at }));
}

/** Undo a Like: deletes every one of the caller's own 'liked' rows for
 * this card (a re-shown card can be liked twice — un-like clears all). */
export async function unlikeCard(cardKey: string): Promise<void> {
  const { error } = await supabase.rpc('unlike_card', { p_card_key: cardKey });
  if (error) throw error;
}

export async function getMyMutedCardFlavors(): Promise<ShareCardFlavor[]> {
  const { data, error } = await supabase.rpc('get_my_card_prefs');
  if (error) throw error;
  const row = (data as { muted_flavors: string[] }[])?.[0];
  return (row?.muted_flavors ?? []) as ShareCardFlavor[];
}

export async function setCardFlavorMuted(flavor: ShareCardFlavor, muted: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_card_flavor_muted', { p_flavor: flavor, p_muted: muted });
  if (error) throw error;
}

/** Renders "no author line" for both a genuinely untraceable-author bank
 * entry (stored as the literal string 'Unknown') and a fact line (stored
 * as null) — same card-rendering rule, two different data reasons. */
export function hasAttributionLine(attribution: string | null): boolean {
  return !!attribution && attribution !== 'Unknown';
}
