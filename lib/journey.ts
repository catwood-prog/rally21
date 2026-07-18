import { supabase } from './supabase';

// The journey ladder (Rally21-Glow-Spec.md §8): a circle no longer ends at
// day 21. Day 21 is the one decision gate (rally on / complete); after
// that, every 21 days is a quiet rally marker and 50/100/365 are major
// stops — all the way up the same circle row, no reset.
export const GATE_DAY = 21;
const MAJOR_STOPS = [50, 100, 365] as const;

export type JourneyLeg = {
  /** The next named stop on the ladder, or null once past the last named
   * stop (365) — the journey still continues, it just has no further
   * target to show a progress bar against. */
  targetDay: number | null;
  label: string;
};

/** Pre-gate (day < 21) callers should keep showing the plain "Day N of 21"
 * pill instead of calling this — it only makes sense once a circle has
 * rallied on past day 21. */
export function getJourneyLeg(dayNumber: number): JourneyLeg {
  if (dayNumber < 50) return { targetDay: 50, label: 'rallying to 50' };
  if (dayNumber < 100) return { targetDay: 100, label: 'rallying to 100' };
  if (dayNumber < 365) return { targetDay: 365, label: 'rallying to 365' };
  return { targetDay: null, label: 'rallying on' };
}

export type Milestone = { day: number; isMajorStop: boolean };

/**
 * The most recent not-yet-celebrated milestone at or before `currentDay`,
 * or null if there's nothing new. Only ever returns ONE milestone even if
 * several were skipped (e.g. the app wasn't opened for a while) — the
 * most recent one wins, matching the "never nags, no backlog" rule; the
 * caller marks it seen via markCelebrationSeen, which never regresses
 * last_celebrated_day, so an older skipped milestone can never re-fire
 * after a newer one has already been shown.
 *
 * Day 21 itself is NOT a candidate here — it's the one decision gate,
 * handled by its own full-screen ceremony, not this quiet-celebration path.
 */
export function getNextMilestone(currentDay: number, lastCelebratedDay: number): Milestone | null {
  const candidates: Milestone[] = [];
  for (let d = GATE_DAY * 2; d <= currentDay; d += GATE_DAY) {
    candidates.push({ day: d, isMajorStop: false });
  }
  for (const stop of MAJOR_STOPS) {
    if (stop <= currentDay) candidates.push({ day: stop, isMajorStop: true });
  }

  const eligible = candidates.filter((c) => c.day > lastCelebratedDay);
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => b.day - a.day);
  return eligible[0];
}

/** How many rallies (21-day legs past the first) a given day represents —
 * used for the rally-marker copy ("rally 3 complete"). Day 42 is rally 1,
 * day 63 is rally 2, etc. */
export function rallyNumber(day: number): number {
  return Math.round((day - GATE_DAY) / GATE_DAY);
}

/** The caller's own last_celebrated_day for this circle — governs both
 * whether the day-21 gate still needs answering (for THIS member; the
 * circle-level decision itself lives on rallied_on_at/completed_at) and
 * whether a later rally marker / major stop is still unseen. */
export async function getMyLastCelebratedDay(circleId: string, userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('memberships')
    .select('last_celebrated_day')
    .eq('circle_id', circleId)
    .eq('user_id', userId)
    .maybeSingle<{ last_celebrated_day: number }>();

  if (error) throw error;
  return data?.last_celebrated_day ?? 0;
}

/** Any member can rally on — first tap wins, idempotent (a second tap by
 * anyone, including after someone else already answered, is a no-op). */
export async function rallyOnCircle(circleId: string): Promise<void> {
  const { error } = await supabase.rpc('rally_on_circle', { p_circle_id: circleId });
  if (error) throw error;
}

/** Creator-only. Available from the day-21 gate AND anytime after from
 * host controls — completing an already-completed circle is a no-op. */
export async function completeCircle(circleId: string): Promise<void> {
  const { error } = await supabase.rpc('complete_circle', { p_circle_id: circleId });
  if (error) throw error;
}

/** Records a celebration as seen for the caller's own membership row.
 * Pass kind+body only for rally markers / major stops (they get their
 * own per-member journal fact); the day-21 gate itself needs no kind —
 * completeCircle already wrote everyone's journal fact, and rally-on
 * needs no fact at all. */
/** SC3 — the Wrapped offer's own monotonic marker (mirrors
 * last_celebrated_day): the highest milestone day whose keepsake offer
 * this member has already SEEN for this circle. Declined offers never
 * reappear; the same machinery serves the 50/100/365 stops later. */
export async function getMyLastWrappedOfferDay(circleId: string, userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('memberships')
    .select('last_wrapped_offer_day')
    .eq('circle_id', circleId)
    .eq('user_id', userId)
    .maybeSingle<{ last_wrapped_offer_day: number }>();
  if (error) throw error;
  return data?.last_wrapped_offer_day ?? 0;
}

export async function markWrappedOffered(circleId: string, day: number): Promise<void> {
  const { error } = await supabase.rpc('mark_wrapped_offered', {
    p_circle_id: circleId,
    p_day: day,
  });
  if (error) throw error;
}

export async function markCelebrationSeen(
  circleId: string,
  day: number,
  celebration?: { kind: 'rally_marker' | 'major_stop'; body: string }
): Promise<void> {
  const { error } = await supabase.rpc('mark_celebration_seen', {
    p_circle_id: circleId,
    p_day: day,
    p_kind: celebration?.kind ?? null,
    p_body: celebration?.body ?? null,
  });
  if (error) throw error;
}

/** Whether THIS member should be routed to the full-screen day-21
 * ceremony right now — true only for the very first qualifying open
 * (myLastCelebratedDay < GATE_DAY). Once seen, mark_celebration_seen
 * bumps last_celebrated_day to 21 so this goes false for good, even if
 * the circle is still unanswered — the quiet persistent card on the
 * circle screen takes over from there instead of re-blocking. */
export function shouldShowJourneyGate(
  dayNumber: number,
  circle: { completedAt: string | null },
  myLastCelebratedDay: number
): boolean {
  return dayNumber >= GATE_DAY && !circle.completedAt && myLastCelebratedDay < GATE_DAY;
}

export type JournalFact = {
  id: string;
  // 'glow_milestone' (Rally21-Glow-Spec.md §4) shares this same table —
  // journal_facts is a general system-journal-entry surface, not
  // R1-exclusive, even though this module is otherwise journey-specific.
  kind: 'circle_completed' | 'rally_marker' | 'major_stop' | 'glow_milestone';
  body: string;
  localDate: string;
  createdAt: string;
};

export async function getMyJournalFacts(userId: string): Promise<JournalFact[]> {
  const { data, error } = await supabase
    .from('journal_facts')
    .select('id, kind, body, local_date, created_at')
    .eq('user_id', userId)
    .order('local_date', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    body: row.body,
    localDate: row.local_date,
    createdAt: row.created_at,
  }));
}
