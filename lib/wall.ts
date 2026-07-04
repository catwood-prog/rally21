import { supabase } from './supabase';

export type WallMessage = {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
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
};

export async function getWallMessages(circleId: string): Promise<WallMessage[]> {
  const { data, error } = await supabase
    .from('wall_messages')
    .select('id, user_id, body, created_at')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((m) => ({
    id: m.id,
    userId: m.user_id,
    body: m.body,
    createdAt: m.created_at,
  }));
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

/** Every check-in in the circle (from the content-free presence table),
 * with whatever reactions have been left on each one. */
export async function getCheckinFeed(circleId: string): Promise<CheckinFeedEntry[]> {
  const [{ data: presence, error: presenceError }, { data: reactions, error: reactionsError }] =
    await Promise.all([
      supabase
        .from('checkin_presence')
        .select('user_id, local_date, created_at')
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
    reactions: (reactions ?? [])
      .filter((r) => r.target_user_id === p.user_id && r.target_local_date === p.local_date)
      .map((r) => ({ emoji: r.emoji, fromUserId: r.from_user_id })),
  }));
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

/** Live updates whenever anyone posts a message or reacts. Returns an
 * unsubscribe function. */
export function subscribeToWall(circleId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`circle-wall-${circleId}`)
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
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
