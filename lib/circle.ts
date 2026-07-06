import { isHttpUrl } from './resourceLink';
import { captureError } from './sentry';
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
  resourceUrl: string | null;
};

export type CircleMember = {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
};

/** A circle with exactly one member gets the solo-practice UI treatment
 * (no "with your circle" framing, no member row) across Today, the
 * circle screen, and welcome-back. */
export function isSoloCircle(memberCount: number): boolean {
  return memberCount === 1;
}

type CircleRow = {
  id: string;
  name: string;
  time_of_day: string | null;
  start_date: string;
  duration_days: number;
  invite_code: string;
  created_by: string;
  resource_url: string | null;
  practices: { name: string; duration_minutes: number | null } | null;
};

const CIRCLE_SELECT =
  'circles(id, name, time_of_day, start_date, duration_days, invite_code, created_by, resource_url, practices(name, duration_minutes))';

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
    resourceUrl: c.resource_url,
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

export type CircleSelection =
  | { kind: 'picker'; circles: MyCircle[] }
  | { kind: 'single'; circle: MyCircle | null };

/** The shared "if circleId, fetch it; else look at the user's own circles
 * and either use the one unambiguous circle or ask which one" pattern
 * used by the circle tab, wall, and invite screens (see CLAUDE.md's "no
 * primary circle" rule) — never guesses "the first one" when there's more
 * than one.
 *
 * A truthy-but-invalid circleId (including the literal string
 * `"undefined"` — what `router.setParams({ circleId: undefined })`
 * serializes to, the cause of a real shipped bug) is always treated as an
 * explicit id to fetch and resolves to `{ kind: 'single', circle: null }`,
 * never silently reinterpreted as "no circleId provided". Callers must
 * clear the param with `router.replace(...)`, not
 * `router.setParams({ circleId: undefined })`.
 *
 * Takes its two lookups as an injectable `deps` (defaulting to the real
 * getCircleById/listMyCircles) purely so tests can substitute fakes
 * without network access — call sites never pass this argument. */
export async function resolveCircleSelection(
  circleId: string | undefined,
  userId: string,
  deps: {
    getCircleById: (id: string) => Promise<MyCircle | null>;
    listMyCircles: (userId: string) => Promise<MyCircle[]>;
  } = { getCircleById, listMyCircles }
): Promise<CircleSelection> {
  if (circleId) {
    const circle = await deps.getCircleById(circleId);
    return { kind: 'single', circle };
  }
  const circles = await deps.listMyCircles(userId);
  if (circles.length > 1) {
    return { kind: 'picker', circles };
  }
  return { kind: 'single', circle: circles[0] ?? null };
}

export async function getCircleById(circleId: string): Promise<MyCircle | null> {
  const { data, error } = await supabase
    .from('circles')
    .select(
      'id, name, time_of_day, start_date, duration_days, invite_code, created_by, resource_url, practices(name, duration_minutes)'
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

/** RLS-gated the same way as renameCircle — creator only. Pass null (or
 * an empty string) to remove the link. Non-empty values must be http(s);
 * the same rule is enforced by the `circles_resource_url_http_check` DB
 * constraint, so a bad value fails closed even if this check is bypassed. */
export async function setCircleResourceUrl(circleId: string, url: string | null): Promise<void> {
  const trimmed = url?.trim() || null;
  if (trimmed && !isHttpUrl(trimmed)) {
    throw new Error('link must start with http:// or https://');
  }
  const { error } = await supabase.from('circles').update({ resource_url: trimmed }).eq('id', circleId);
  if (error) throw error;
}

/** Deletes the caller's own membership — their completions and
 * reflections are untouched (history belongs to the member, not the
 * circle). If that was the circle's last member, the RPC marks it
 * inactive rather than deleting it, so its history and invite code
 * survive for anyone who wants to come back. No host handover: if the
 * creator leaves and others remain, the circle just keeps running
 * creator-less (see CLAUDE.md). */
export async function leaveCircle(circleId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_circle', { p_circle_id: circleId });
  if (error) {
    captureError(error, { rpc: 'leave_circle' });
    throw error;
  }
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

export type PresenceKind = 'self' | 'covered';

/** Every (user_id, local_date) a circle has completed — used both for
 * "who's in today" and the trailing-7-day glow math. Reads directly from
 * completions, which is content-free by design (no mood/line/answer), so
 * it's safe to expose to every circle member unlike the owner-only
 * reflections table.
 *
 * Includes covered days (kind='covered') — a covered day counts toward
 * the circle's glow the same as a self check-in (see CLAUDE.md's
 * cover-a-friend rule). `kind`/`coveredBy` let the UI render a distinct
 * "covered 💛" state instead of a plain checkmark; computeSignal itself
 * ignores them entirely, since the glow math only cares who showed up. */
export async function getCirclePresence(
  circleId: string
): Promise<{ userId: string; localDate: string; kind: PresenceKind; coveredBy: string | null }[]> {
  const { data, error } = await supabase
    .from('completions')
    .select('user_id, local_date, kind, covered_by')
    .eq('circle_id', circleId);

  if (error) throw error;
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    localDate: row.local_date,
    kind: row.kind as PresenceKind,
    coveredBy: row.covered_by,
  }));
}

/** The signed-in user's own SELF completions across a set of circles —
 * powers the weekly look-back's per-circle show-up rows. Deliberately
 * excludes covered days: being covered keeps the circle's glow warm, but
 * never inflates the covered member's own personal show-up count (see
 * CLAUDE.md's cover-a-friend rule) — that stays honest to what they
 * actually did themselves. */
export async function getMyCompletions(
  userId: string,
  circleIds: string[]
): Promise<{ circleId: string; localDate: string }[]> {
  if (circleIds.length === 0) return [];

  const { data, error } = await supabase
    .from('completions')
    .select('circle_id, local_date')
    .eq('user_id', userId)
    .eq('kind', 'self')
    .in('circle_id', circleIds);

  if (error) throw error;
  return (data ?? []).map((row) => ({ circleId: row.circle_id, localDate: row.local_date }));
}

/** Covers another member's day for a circle — a gift, never a debt (see
 * CLAUDE.md). All the rules (can't cover yourself, must be a member,
 * covered person must be a member, covered person hasn't already
 * completed today) are enforced by RLS itself, not here — this is a
 * plain insert that either succeeds or throws the policy's rejection. */
export async function coverMember(
  circleId: string,
  coveredUserId: string,
  covererId: string,
  localDate: string
): Promise<void> {
  const { error } = await supabase.from('completions').insert({
    circle_id: circleId,
    user_id: coveredUserId,
    local_date: localDate,
    kind: 'covered',
    covered_by: covererId,
  });
  if (error) throw error;
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
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        captureError(new Error(`circle presence subscription ${status}`), { table: 'completions' });
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}
