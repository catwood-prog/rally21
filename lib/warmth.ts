// WL2 — the warmth arrives. Delivery surfaces for the recipient-private
// heart/wave rows WL1 created (Cat's 21 July rulings; design record in
// DEFERRED's circle-wall bullet):
// - the Today whisper: a quiet line under the header, only when warmth
//   arrived since last seen; fades once seen, never a badge or count.
// - the check-in echo: one warm line on the completion screen when
//   fresh warmth exists there; same seen-marker, so whichever surface
//   renders first consumes it and warmth never re-renders stale.
// - the wall teaser: one quiet line per circle on Today — the latest
//   wall item someone ELSE left (a teaser for your own post is noise),
//   only when newer than your last wall visit.
import { supabase } from './supabase';

export type WarmthKind = 'wave' | 'heart';

export type FreshWarmth = {
  kind: WarmthKind;
  senderName: string;
  /** Raw server timestamp string, passed back verbatim to
   * markWarmthSeen so no client-side Date round-trip ever truncates
   * the microseconds the seen-gate compares against. */
  createdAt: string;
};

export type WallTeaserItem = {
  kind: 'post' | 'celebration';
  userId: string;
  body: string;
  createdAt: string;
};

/** Warmth that arrived since the caller last saw any — the seen-gate
 * lives SERVER-side in get_my_fresh_warmth (stale warmth never crosses
 * the API), recipient-only by construction (keyed on auth.uid()).
 * Newest first. */
export async function getFreshWarmth(): Promise<FreshWarmth[]> {
  const { data, error } = await supabase.rpc('get_my_fresh_warmth');
  if (error) throw error;
  return ((data ?? []) as { kind: string; sender_name: string; created_at: string }[]).map((r) => ({
    kind: r.kind as WarmthKind,
    senderName: r.sender_name,
    createdAt: r.created_at,
  }));
}

/** Consumes the warmth just shown: the marker moves to the newest SHOWN
 * row's own timestamp (not now()), so anything that arrived between the
 * read and this write stays fresh for the next surface. */
export async function markWarmthSeen(userId: string, newestShownCreatedAt: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ warmth_seen_at: newestShownCreatedAt })
    .eq('id', userId);
  if (error) throw error;
}

/** The latest wall line someone else left in this circle (post or
 * celebration — same visibility rule as the wall itself). Null when the
 * wall has nothing from anyone else. */
export async function getWallTeaser(
  circleId: string,
  myUserId: string
): Promise<WallTeaserItem | null> {
  const { data, error } = await supabase
    .from('wall_messages')
    .select('kind, user_id, body, created_at')
    .eq('circle_id', circleId)
    .in('kind', ['post', 'celebration'])
    .neq('user_id', myUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ kind: string; user_id: string; body: string; created_at: string }>();

  if (error) throw error;
  if (!data) return null;
  return {
    kind: data.kind as WallTeaserItem['kind'],
    userId: data.user_id,
    body: data.body,
    createdAt: data.created_at,
  };
}

/** Stamps the caller's own membership row — called on wall open. */
export async function markWallSeen(circleId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_wall_seen', { p_circle_id: circleId });
  if (error) throw error;
}

/** How many whisper lines render individually before the rest fold into
 * one warm overflow line — compact stacking, never a scroll of chrome. */
export const WHISPER_MAX_LINES = 4;

/** The whisper's render decision: one line per warmth row (newest
 * first, as served), individually up to WHISPER_MAX_LINES; anything
 * beyond folds into a single overflow marker. Empty in = null out — the
 * surface is absent entirely, never an empty frame. */
export function buildWhisperLines(
  rows: FreshWarmth[]
): { lines: FreshWarmth[]; overflowCount: number } | null {
  if (rows.length === 0) return null;
  return {
    lines: rows.slice(0, WHISPER_MAX_LINES),
    overflowCount: Math.max(0, rows.length - WHISPER_MAX_LINES),
  };
}

/** The echo's render decision: exactly one line, the newest fresh
 * warmth; none = null = the surface is absent. */
export function buildEchoLine(rows: FreshWarmth[]): FreshWarmth | null {
  return rows.length > 0 ? rows[0] : null;
}

/** The teaser's newer-than gate. A null wallSeenAt means the wall was
 * never visited — everything is newer than a visit that never happened,
 * so any item shows. No item at all = nothing to tease. */
export function isWallTeaserFresh(
  item: WallTeaserItem | null,
  wallSeenAt: string | null | undefined
): boolean {
  if (!item) return false;
  if (!wallSeenAt) return true;
  return new Date(item.createdAt).getTime() > new Date(wallSeenAt).getTime();
}
