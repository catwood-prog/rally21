// WL2 — the warmth arrives. Delivery surfaces for the recipient-private
// heart/wave rows WL1 created (Cat's 21 July rulings; design record in
// DEFERRED's circle-wall bullet):
// - the Today whisper: a quiet line under the header, only when warmth
//   arrived since last seen; fades once seen, never a badge or count.
//   RETIRED by TN1 (24 July) into Today's notification spot, which keeps
//   every one of those laws — see lib/notificationSpot.ts.
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
  /** AU1 job 3b/3c — WHO sent it. The spot renders the shared Avatar
   * (penguin variant is deterministic on this id, per AV1) and merges
   * a person's moments on it, so two circle-mates sharing a display
   * name can never collapse into one card. Nullable only in theory:
   * wall_messages.user_id is not null, but the left join that keeps a
   * departed sender's warmth readable is what types it that way. */
  senderId: string | null;
  senderName: string;
  senderAvatarUrl: string | null;
  /** Raw server timestamp string, passed back verbatim to
   * markWarmthSeen so no client-side Date round-trip ever truncates
   * the microseconds the seen-gate compares against. */
  createdAt: string;
};

export type WallTeaserItem = {
  kind: 'post' | 'celebration' | 'milestone';
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
  return (
    (data ?? []) as {
      kind: string;
      sender_id: string | null;
      sender_name: string;
      sender_avatar_url: string | null;
      created_at: string;
    }[]
  ).map((r) => ({
    kind: r.kind as WarmthKind,
    senderId: r.sender_id ?? null,
    senderName: r.sender_name,
    senderAvatarUrl: r.sender_avatar_url ?? null,
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

/** The latest wall line someone else left in this circle (post,
 * celebration or milestone — same visibility rule as the wall itself).
 * Null when the wall has nothing from anyone else.
 *
 * PA4 (memo §6): a rally milestone teases here for the reason the memo
 * gives for putting it on the wall in the first place — TN1's spot is
 * shown once and then gone, so a 100-practice moment needs a home a
 * person can come back to, and the teaser is the existing pointer from
 * Today to that home. This is the newest-line teaser, not a milestone
 * feed: a milestone teases only while it IS the latest line, and one
 * line is showing at a time, never a list of everyone's counts. */
export async function getWallTeaser(
  circleId: string,
  myUserId: string
): Promise<WallTeaserItem | null> {
  const { data, error } = await supabase
    .from('wall_messages')
    .select('kind, user_id, body, created_at')
    .eq('circle_id', circleId)
    .in('kind', ['post', 'celebration', 'milestone'])
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

// TN1 (24 July) — buildWhisperLines/WHISPER_MAX_LINES are RETIRED: the
// Today whisper folded into the notification spot, which is now Today's
// ONE warm surface (lib/notificationSpot.ts owns that render decision,
// and inherited the whisper's cap/overflow test cases). The check-in
// echo below is unchanged and still shares the same seen-marker, so
// whichever surface renders first still consumes the warmth.

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
