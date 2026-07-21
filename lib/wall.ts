import { createRealtimeStatusGate, subscribeToAppWake } from './realtimeRecovery';
import { captureError } from './sentry';
import { supabase } from './supabase';

export type WallMessage = {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
  reactions: WallReaction[];
};

export type WallReaction = {
  emoji: string;
  fromUserId: string;
};

/** AC1 (15 July): hearts went from gold to orange, but stored reaction
 * rows are never migrated — a row inserted before the switch still holds
 * the literal '💛' string. Every reaction read path maps it to '🧡' here,
 * at render time, so historic reactions count toward the same chip and
 * display the same as ones sent today; the curated pickers (wall.tsx's
 * QUICK_REACTIONS/OPEN_CIRCLE_REACTIONS) only ever offer '🧡' going
 * forward. (Since WL1 the only reaction surface is human posts —
 * wall_message_reactions; the retired checkin_reactions rows keep their
 * stored emoji but no longer render anywhere.) */
export function displayReactionEmoji(emoji: string): string {
  return emoji === '💛' ? '🧡' : emoji;
}

export type WallPreviewItem = { id: string; userId: string; body: string; createdAt: string };

/** WL1 (21 July, Cat's ruling): the wall renders human posts and system
 * celebration lines only. Wave/heart rows still live in wall_messages
 * but are recipient-private — RLS already hides them from everyone but
 * the recipient; this kind filter keeps the recipient's own warmth off
 * the wall too (WL2's surfaces deliver it instead). */
const WALL_VISIBLE_KINDS = ['post', 'celebration'];

export async function getWallMessages(circleId: string): Promise<WallMessage[]> {
  const { data, error } = await supabase
    .from('wall_messages')
    .select('id, user_id, body, created_at, wall_message_reactions(from_user_id, emoji)')
    .eq('circle_id', circleId)
    .in('kind', WALL_VISIBLE_KINDS)
    .order('created_at', { ascending: true })
    .returns<
      {
        id: string;
        user_id: string;
        body: string;
        created_at: string;
        wall_message_reactions: { from_user_id: string; emoji: string }[];
      }[]
    >();

  if (error) throw error;
  return (data ?? []).map((m) => ({
    id: m.id,
    userId: m.user_id,
    body: m.body,
    createdAt: m.created_at,
    reactions: (m.wall_message_reactions ?? []).map((r) => ({
      emoji: displayReactionEmoji(r.emoji),
      fromUserId: r.from_user_id,
    })),
  }));
}

/** One reaction per person per wall message — picking a different emoji
 * replaces your previous one, mirroring setCheckinReaction. */
export async function setWallMessageReaction(params: {
  messageId: string;
  fromUserId: string;
  emoji: string;
}): Promise<void> {
  const { error } = await supabase.from('wall_message_reactions').upsert(
    { message_id: params.messageId, from_user_id: params.fromUserId, emoji: params.emoji },
    { onConflict: 'message_id,from_user_id' }
  );
  if (error) throw error;
}

/** Host content moderation (public circles): the circle's creator can
 * delete any wall post — enforced by RLS, not here (see CLAUDE.md). */
export async function deleteWallMessage(messageId: string): Promise<void> {
  const { error } = await supabase.from('wall_messages').delete().eq('id', messageId);
  if (error) throw error;
}

/** Whether a specific circle-mate currently accepts friend nudges —
 * routed through a SECURITY DEFINER RPC since notification_prefs RLS
 * only lets a user read their own row. Callers must never show a reason
 * when this is false ("affordance silently absent", never "she muted
 * you" — Notifications spec §4b). */
export async function isFriendNudgeEnabled(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_friend_nudge_enabled', { p_user_id: userId });
  if (error) {
    captureError(error, { rpc: 'is_friend_nudge_enabled' });
    throw error;
  }
  return data ?? true;
}

/** HW1 (15 July): the two friend gestures. The heart rides the wave's
 * own server path — same RPC, same guards — it is never a fork. */
export type FriendGestureKind = 'wave' | 'heart';

/** Sends a pre-written friend gesture (Notifications spec §4b; Security
 * spec §S1 F4). Routed through a SECURITY DEFINER RPC — notification_outbox
 * has no client RLS access at all, and the email/wall copy is composed
 * server-side from a fixed template — the RPC never accepts client-
 * composed subject/HTML/wall text (a client could otherwise send
 * arbitrary HTML email, or bypass the public-circle wall gate with
 * attacker-chosen text). W1 (7 July, Cat's ruling): the wave is a
 * connection tool, not only a check-in nudge — it never fails for
 * social reasons anymore. HW1 (15 July, Cat's ruling): `kind: 'heart'`
 * is an even lighter gesture riding this same path — per-recipient
 * daily dedupe applies PER KIND (a wave and a heart to the same friend
 * the same day are both fine), the 10/day sender cap is SHARED across
 * kinds, and a heart NEVER creates a notification_outbox row (no email,
 * no future push) — it lands as a synchronous wall line only.
 * Returns 'already_nudged' (no error, no wall post) if someone else got
 * there first today with the same kind (the real per-recipient abuse
 * guard, one received wave/heart per person per day), or
 * 'wave_cap_reached' if the SENDER has hit their own quiet daily send
 * cap, or 'blocked' (MOD1) if either side has blocked the other — none
 * of these are errors, all are designed, warm-copy outcomes. Gesture-
 * at-yourself/not-a-member/opted-out still raise, since the UI shouldn't
 * let those happen at all. */
export async function sendFriendNudge(params: {
  circleId: string;
  recipientId: string;
  localDate: string;
  /** Defaults to 'wave' so the cover flow's existing call is unchanged. */
  kind?: FriendGestureKind;
}): Promise<'sent' | 'already_nudged' | 'wave_cap_reached' | 'blocked'> {
  const { data, error } = await supabase.rpc('send_friend_nudge', {
    p_circle_id: params.circleId,
    p_recipient_id: params.recipientId,
    p_local_date: params.localDate,
    p_kind: params.kind ?? 'wave',
  });
  if (error) {
    captureError(error, { rpc: 'send_friend_nudge' });
    throw error;
  }
  return data as 'sent' | 'already_nudged' | 'wave_cap_reached' | 'blocked';
}

export async function postWallMessage(
  circleId: string,
  userId: string,
  body: string
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  const { error } = await supabase
    .from('wall_messages')
    .insert({ circle_id: circleId, user_id: userId, body: trimmed });

  if (error) throw error;
}

/** OC1's earned-voice gate mirror: the caller's completion count in
 * this circle, ALL kinds — a covered day counts toward voice exactly as
 * it does in the RLS INSERT policy's own count. Formerly derived from
 * the wall's check-in feed; WL1 removed that feed, so the gate reads
 * the count directly. */
export async function getMyCircleCompletionCount(
  circleId: string,
  userId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('completions')
    .select('id', { count: 'exact', head: true })
    .eq('circle_id', circleId)
    .eq('user_id', userId);

  if (error) throw error;
  return count ?? 0;
}

/** The last `limit` wall lines (posts + celebrations, same visibility
 * rule as the wall itself), oldest first (so the newest reads last,
 * bottom of a preview card). Powers the circle screen's wall preview. */
export async function getWallPreview(circleId: string, limit = 3): Promise<WallPreviewItem[]> {
  const { data, error } = await supabase
    .from('wall_messages')
    .select('id, user_id, body, created_at')
    .eq('circle_id', circleId)
    .in('kind', WALL_VISIBLE_KINDS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? [])
    .map((m) => ({ id: m.id, userId: m.user_id, body: m.body, createdAt: m.created_at }))
    .reverse();
}

let wallChannelSeq = 0;

/** Live updates whenever anyone posts a message or reacts. Returns an
 * unsubscribe function.
 *
 * Topic includes a per-call sequence number — see subscribeToCirclePresence
 * in lib/circle.ts for why a shared topic string is unsafe across
 * concurrently mounted screens.
 *
 * RT1 (15 July) — same resilience treatment as subscribeToCirclePresence
 * (see there / lib/realtimeRecovery.ts): refetch on channel recovery and
 * on app wake, report to Sentry only after consecutive failed joins. */
export function subscribeToWall(circleId: string, onChange: () => void): () => void {
  const statusGate = createRealtimeStatusGate();
  const channel = supabase
    .channel(`circle-wall-${circleId}-${++wallChannelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'wall_messages', filter: `circle_id=eq.${circleId}` },
      onChange
    )
    .on(
      // wall_message_reactions has no circle_id column to filter on (only
      // message_id), so this fires for every circle's reactions — harmless,
      // it just triggers an extra reload of this circle's own feed.
      'postgres_changes',
      { event: '*', schema: 'public', table: 'wall_message_reactions' },
      onChange
    )
    .subscribe((status) => {
      const { refetch, reportFailureCount } = statusGate(status);
      if (refetch) onChange();
      if (reportFailureCount !== null) {
        captureError(
          new Error(`wall subscription ${status} after ${reportFailureCount} consecutive failures`),
          { table: 'wall_messages', consecutiveFailures: String(reportFailureCount) }
        );
      }
    });
  const stopWakeRefetch = subscribeToAppWake(onChange);

  return () => {
    stopWakeRefetch();
    supabase.removeChannel(channel);
  };
}
