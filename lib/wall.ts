import { captureError } from './sentry';
import { supabase } from './supabase';

export type WallMessage = {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
  reactions: CheckinReaction[];
};

export type CheckinReaction = {
  emoji: string;
  fromUserId: string;
};

export type CheckinFeedEntry = {
  userId: string;
  localDate: string;
  createdAt: string;
  reactions: CheckinReaction[];
  kind: 'self' | 'covered';
  /** Only set when kind is 'covered' — who gave the gift, so the wall
   * can render "{coveredBy} covered {userId} today 💛" instead of the
   * plain "{userId} checked in" (see CLAUDE.md's cover-a-friend rule). */
  coveredBy: string | null;
};

export type WallPreviewItem =
  | { kind: 'message'; id: string; userId: string; body: string; createdAt: string }
  | {
      kind: 'reaction';
      id: string;
      fromUserId: string;
      targetUserId: string;
      emoji: string;
      createdAt: string;
    };

export async function getWallMessages(circleId: string): Promise<WallMessage[]> {
  const { data, error } = await supabase
    .from('wall_messages')
    .select('id, user_id, body, created_at, wall_message_reactions(from_user_id, emoji)')
    .eq('circle_id', circleId)
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
    reactions: (m.wall_message_reactions ?? []).map((r) => ({ emoji: r.emoji, fromUserId: r.from_user_id })),
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

/** Sends a pre-written friend nudge (Notifications spec §4b; Security
 * spec §S1 F4). Routed through a SECURITY DEFINER RPC — notification_outbox
 * has no client RLS access at all, the anti-pile-on rule (one received
 * nudge per person per day, across all circles/senders) is enforced
 * server-side via that table's dedupe_key, and the email/wall copy is
 * composed server-side from a fixed template — the RPC never accepts
 * client-composed subject/HTML/wall text (a client could otherwise send
 * arbitrary HTML email, or bypass the public-circle wall gate with
 * attacker-chosen text). Returns 'already_nudged' (no error, no wall
 * post) if someone else got there first today — never nudge-yourself or
 * already-checked-in states, which raise instead since the UI shouldn't
 * let those happen. */
export async function sendFriendNudge(params: {
  circleId: string;
  recipientId: string;
  localDate: string;
}): Promise<'sent' | 'already_nudged'> {
  const { data, error } = await supabase.rpc('send_friend_nudge', {
    p_circle_id: params.circleId,
    p_recipient_id: params.recipientId,
    p_local_date: params.localDate,
  });
  if (error) {
    captureError(error, { rpc: 'send_friend_nudge' });
    throw error;
  }
  return data as 'sent' | 'already_nudged';
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

/** Every completion in the circle (content-free — no mood/line/answer),
 * with whatever reactions have been left on each one. */
export async function getCheckinFeed(circleId: string): Promise<CheckinFeedEntry[]> {
  const [{ data: presence, error: presenceError }, { data: reactions, error: reactionsError }] =
    await Promise.all([
      supabase
        .from('completions')
        .select('user_id, local_date, created_at, kind, covered_by')
        .eq('circle_id', circleId),
      supabase
        .from('checkin_reactions')
        .select('target_user_id, target_local_date, from_user_id, emoji')
        .eq('circle_id', circleId),
    ]);

  if (presenceError) throw presenceError;
  if (reactionsError) throw reactionsError;

  return (presence ?? []).map((p) => ({
    userId: p.user_id,
    localDate: p.local_date,
    createdAt: p.created_at,
    kind: p.kind as 'self' | 'covered',
    coveredBy: p.covered_by,
    reactions: (reactions ?? [])
      .filter((r) => r.target_user_id === p.user_id && r.target_local_date === p.local_date)
      .map((r) => ({ emoji: r.emoji, fromUserId: r.from_user_id })),
  }));
}

/** The last `limit` wall events — messages and check-in reactions merged
 * into one chronological strip, oldest first (so the newest reads last,
 * bottom of a preview card). Powers the circle screen's wall preview. */
export async function getWallPreview(circleId: string, limit = 3): Promise<WallPreviewItem[]> {
  const [{ data: messages, error: messagesError }, { data: reactions, error: reactionsError }] =
    await Promise.all([
      supabase
        .from('wall_messages')
        .select('id, user_id, body, created_at')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase
        .from('checkin_reactions')
        .select('id, from_user_id, target_user_id, emoji, created_at')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false })
        .limit(limit),
    ]);

  if (messagesError) throw messagesError;
  if (reactionsError) throw reactionsError;

  const items: WallPreviewItem[] = [
    ...(messages ?? []).map(
      (m): WallPreviewItem => ({
        kind: 'message',
        id: m.id,
        userId: m.user_id,
        body: m.body,
        createdAt: m.created_at,
      })
    ),
    ...(reactions ?? []).map(
      (r): WallPreviewItem => ({
        kind: 'reaction',
        id: r.id,
        fromUserId: r.from_user_id,
        targetUserId: r.target_user_id,
        emoji: r.emoji,
        createdAt: r.created_at,
      })
    ),
  ];

  return items
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .reverse();
}

/** One reaction per person per check-in — picking a different emoji
 * replaces your previous one rather than stacking. */
export async function setCheckinReaction(params: {
  circleId: string;
  targetUserId: string;
  targetLocalDate: string;
  fromUserId: string;
  emoji: string;
}): Promise<void> {
  const { error } = await supabase.from('checkin_reactions').upsert(
    {
      circle_id: params.circleId,
      target_user_id: params.targetUserId,
      target_local_date: params.targetLocalDate,
      from_user_id: params.fromUserId,
      emoji: params.emoji,
    },
    { onConflict: 'circle_id,target_user_id,target_local_date,from_user_id' }
  );

  if (error) throw error;
}

let wallChannelSeq = 0;

/** Live updates whenever anyone posts a message or reacts. Returns an
 * unsubscribe function.
 *
 * Topic includes a per-call sequence number — see subscribeToCirclePresence
 * in lib/circle.ts for why a shared topic string is unsafe across
 * concurrently mounted screens. */
export function subscribeToWall(circleId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`circle-wall-${circleId}-${++wallChannelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'wall_messages', filter: `circle_id=eq.${circleId}` },
      onChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'checkin_reactions', filter: `circle_id=eq.${circleId}` },
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
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        captureError(new Error(`wall subscription ${status}`), { table: 'wall_messages' });
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}
