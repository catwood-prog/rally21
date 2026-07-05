import { supabase } from './supabase';

export type MyCircle = {
  id: string;
  name: string;
  timeOfDay: string | null;
  startDate: string;
  durationDays: number;
  practiceName: string | null;
  practiceDurationMinutes: number | null;
  inviteCode: string;
  createdBy: string;
};

export type CircleMember = {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
};

type CircleRow = {
  id: string;
  name: string;
  time_of_day: string | null;
  start_date: string;
  duration_days: number;
  invite_code: string;
  created_by: string;
  practices: { name: string; duration_minutes: number | null } | null;
};

const CIRCLE_SELECT =
  'circles(id, name, time_of_day, start_date, duration_days, invite_code, created_by, practices(name, duration_minutes))';

function mapCircleRow(c: CircleRow): MyCircle {
  return {
    id: c.id,
    name: c.name,
    timeOfDay: c.time_of_day,
    startDate: c.start_date,
    durationDays: c.duration_days,
    practiceName: c.practices?.name ?? null,
    practiceDurationMinutes: c.practices?.duration_minutes ?? null,
    inviteCode: c.invite_code,
    createdBy: c.created_by,
  };
}

/** Every circle the user belongs to, ordered by earliest committed time
 * of day (circles with no set time sort last) — the order Today's stack
 * renders cards in. */
export async function listMyCircles(userId: string): Promise<MyCircle[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select(CIRCLE_SELECT)
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .returns<{ circles: CircleRow }[]>();

  if (error) throw error;

  return (data ?? [])
    .filter((row) => !!row.circles)
    .map((row) => mapCircleRow(row.circles))
    .sort((a, b) => {
      if (a.timeOfDay === b.timeOfDay) return 0;
      if (a.timeOfDay === null) return 1;
      if (b.timeOfDay === null) return -1;
      return a.timeOfDay.localeCompare(b.timeOfDay);
    });
}

export async function getCircleById(circleId: string): Promise<MyCircle | null> {
  const { data, error } = await supabase
    .from('circles')
    .select(
      'id, name, time_of_day, start_date, duration_days, invite_code, created_by, practices(name, duration_minutes)'
    )
    .eq('id', circleId)
    .maybeSingle<CircleRow>();

  if (error) throw error;
  if (!data) return null;

  return mapCircleRow(data);
}

/** RLS restricts this to the circle's creator (created_by = auth.uid()) —
 * there's no host-handover concept yet, so only the original creator can
 * rename, even if they later leave (see CLAUDE.md). */
export async function renameCircle(circleId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const { error } = await supabase.from('circles').update({ name: trimmed }).eq('id', circleId);
  if (error) throw error;
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

/** The signed-in user's own completions across a set of circles — powers
 * the weekly look-back's per-circle show-up rows. */
export async function getMyCompletions(
  userId: string,
  circleIds: string[]
): Promise<{ circleId: string; localDate: string }[]> {
  if (circleIds.length === 0) return [];

  const { data, error } = await supabase
    .from('completions')
    .select('circle_id, local_date')
    .eq('user_id', userId)
    .in('circle_id', circleIds);

  if (error) throw error;
  return (data ?? []).map((row) => ({ circleId: row.circle_id, localDate: row.local_date }));
}

let presenceChannelSeq = 0;

/** Live updates whenever anyone in the circle completes. Returns an
 * unsubscribe function.
 *
 * The topic includes a per-call sequence number: supabase-js reuses any
 * existing channel with the same topic instead of creating a new one, so
 * two screens (e.g. Today and Circle, both kept mounted by the tab bar)
 * subscribing to the same circleId would otherwise hand back the same
 * already-subscribed channel — and calling `.on()` on it a second time
 * throws. A unique topic per call keeps each screen's subscription
 * independent. */
export function subscribeToCirclePresence(circleId: string, onInsert: () => void): () => void {
  const topic = `circle-presence-${circleId}-${++presenceChannelSeq}`;
  const channel = supabase
    .channel(topic)
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
