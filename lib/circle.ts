import { supabase } from './supabase';

export type MyCircle = {
  id: string;
  name: string;
  timeOfDay: string | null;
  startDate: string;
  durationDays: number;
  practiceName: string | null;
  inviteCode: string;
};

export type CircleMember = {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
};

export async function getMyPrimaryCircle(userId: string): Promise<MyCircle | null> {
  const { data, error } = await supabase
    .from('memberships')
    .select(
      'circles(id, name, time_of_day, start_date, duration_days, invite_code, practices(name))'
    )
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle<{
      circles: {
        id: string;
        name: string;
        time_of_day: string | null;
        start_date: string;
        duration_days: number;
        invite_code: string;
        practices: { name: string } | null;
      };
    }>();

  if (error) throw error;
  if (!data?.circles) return null;

  const c = data.circles;
  return {
    id: c.id,
    name: c.name,
    timeOfDay: c.time_of_day,
    startDate: c.start_date,
    durationDays: c.duration_days,
    practiceName: c.practices?.name ?? null,
    inviteCode: c.invite_code,
  };
}

export async function getCircleMembers(circleId: string): Promise<CircleMember[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('user_id, role, users(name, avatar_url)')
    .eq('circle_id', circleId)
    .returns<{ user_id: string; role: string; users: { name: string | null; avatar_url: string | null } | null }[]>();

  if (error) throw error;

  return (data ?? []).map((m) => ({
    userId: m.user_id,
    name: m.users?.name ?? null,
    avatarUrl: m.users?.avatar_url ?? null,
    role: m.role,
  }));
}

/** Every (user_id, local_date) a circle has completed — used both for
 * "who's in today" and the trailing-7-day glow math. Reads directly from
 * completions, which is content-free by design (no mood/line/answer), so
 * it's safe to expose to every circle member unlike the owner-only
 * reflections table. */
export async function getCirclePresence(
  circleId: string
): Promise<{ userId: string; localDate: string }[]> {
  const { data, error } = await supabase
    .from('completions')
    .select('user_id, local_date')
    .eq('circle_id', circleId);

  if (error) throw error;
  return (data ?? []).map((row) => ({ userId: row.user_id, localDate: row.local_date }));
}

/** Live updates whenever anyone in the circle completes. Returns an
 * unsubscribe function. */
export function subscribeToCirclePresence(circleId: string, onInsert: () => void): () => void {
  const channel = supabase
    .channel(`circle-presence-${circleId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'completions', filter: `circle_id=eq.${circleId}` },
      onInsert
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
