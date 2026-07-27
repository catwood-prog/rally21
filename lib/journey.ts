import { supabase } from './supabase';

// PA1 (Rally21-Personal-Arc-Decision-Memo.md §4, 27 July) — THE LADDER IS
// COUNTED IN PRACTICES, NOT CALENDAR DAYS. Every number on this ladder
// (21, 50, 100, 365) is now a count of days this member actually showed
// up for THIS circle, never the circle's age. The circle has an age, not
// a deadline; the member has a rally.
//
// JOB 2b RULING (PA1, stated rather than left implicit): the first rally
// is ALWAYS GATE_DAY — 21 practices — for every circle, and never
// `circles.duration_days`. A rally belongs to the person, so the same
// person must not have a different first milestone in each of their
// circles; and duration_days has no writer anywhere in the app or the
// schema (`int not null default 21`, no UI, no RPC, 21 on every live
// row), so keying the ladder to it would be keying it to a constant
// wearing a column's clothes. duration_days is now VESTIGIAL for the
// rally — see the handoff for its two remaining display readers.
export const GATE_DAY = 21;
const MAJOR_STOPS = [50, 100, 365] as const;

export type JourneyLeg = {
  /** The next named stop on the ladder, or null once past the last named
   * stop (365) — the journey still continues, it just has no further
   * target to show a progress bar against. */
  targetDay: number | null;
  label: string;
};

/** Which leg of the ladder a member's RALLY COUNT sits on. Below the
 * first milestone (count < 21) callers show the plain "your rally: N of
 * 21" line instead — this only makes sense once 21 practices are done. */
export function getJourneyLeg(rallyCount: number): JourneyLeg {
  if (rallyCount < 50) return { targetDay: 50, label: 'rallying to 50' };
  if (rallyCount < 100) return { targetDay: 100, label: 'rallying to 100' };
  if (rallyCount < 365) return { targetDay: 365, label: 'rallying to 365' };
  return { targetDay: null, label: 'rallying on' };
}

/** PA1 JOB 1 — THE COUNT ITSELF, and the two traps it exists to close.
 *
 * A member's RALLY COUNT for a circle is the number of distinct local
 * dates on which THAT member has a completion IN THAT CIRCLE with
 * `kind = 'self'`. Nothing else.
 *
 * TRAP (a) — NOT `glow_qualifying_days`. That function is USER-level with
 * no circle filter, so reusing it would make practising in circle A
 * advance your rally in circle B. A rally belongs to one circle, so the
 * circle filter is not an optimisation, it is the definition.
 *
 * TRAP (b) — NOT `kind='covered'`, and not away days. Those protect the
 * GLOW and never advance the RALLY: a cover is a friend saying "I've got
 * you", not a practice you did, and counting it re-inflates the number
 * exactly the way the circle-day number did (memo §4 corrected, §9).
 * Live proof on 27 July: Catherine S in Stretching/Yoga has 6 self days
 * and 5 covered, so a wrong rule reports 11 instead of 6.
 *
 * `kind` is REQUIRED on the row type on purpose. `signal.ts`'s PresenceRow
 * leaves it optional (computeSignal ignores it), and accepting that type
 * here would let a kind-less row silently count as a practice — trap (b)
 * re-entering through the type system. The compiler now refuses it.
 */
export function countRallyDays(
  presence: { userId: string; localDate: string; kind: 'self' | 'covered' }[],
  userId: string
): number {
  const dates = new Set<string>();
  for (const row of presence) {
    if (row.userId !== userId) continue;
    if (row.kind !== 'self') continue;
    dates.add(row.localDate);
  }
  return dates.size;
}

/** The same count read straight from the database, for screens that do
 * not already hold the circle's presence rows (checkin-complete). The
 * `completions` unique key is (user_id, circle_id, local_date), so a
 * filtered row count and a distinct-date count are the same number —
 * `countRallyDays` still de-duplicates because a pure helper should not
 * depend on a constraint its callers can't see. */
export async function getMyRallyCount(circleId: string, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('completions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('circle_id', circleId)
    .eq('kind', 'self');

  if (error) throw error;
  return count ?? 0;
}

export type Milestone = { day: number; isMajorStop: boolean };

/**
 * The most recent not-yet-celebrated milestone at or before `rallyCount`,
 * or null if there's nothing new. Only ever returns ONE milestone even if
 * several were skipped (e.g. the app wasn't opened for a while) — the
 * most recent one wins, matching the "never nags, no backlog" rule; the
 * caller marks it seen via markCelebrationSeen, which never regresses
 * last_celebrated_day, so an older skipped milestone can never re-fire
 * after a newer one has already been shown.
 *
 * PA1 — the argument is now a PRACTICE COUNT, not a circle day. The
 * ladder's shape is untouched (this is the memo's "mostly a deletion"):
 * only the number handed in changed meaning, and `last_celebrated_day`
 * changed units with it, which is why PA1 carries a reset migration.
 *
 * 21 itself is NOT a candidate here — it's the one decision gate,
 * handled by its own full-screen ceremony, not this quiet-celebration path.
 */
export function getNextMilestone(rallyCount: number, lastCelebratedDay: number): Milestone | null {
  const candidates: Milestone[] = [];
  for (let d = GATE_DAY * 2; d <= rallyCount; d += GATE_DAY) {
    candidates.push({ day: d, isMajorStop: false });
  }
  for (const stop of MAJOR_STOPS) {
    if (stop <= rallyCount) candidates.push({ day: stop, isMajorStop: true });
  }

  const eligible = candidates.filter((c) => c.day > lastCelebratedDay);
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => b.day - a.day);
  return eligible[0];
}

/** How many rallies (21-practice legs past the first) a given milestone
 * represents — used for the rally-marker copy ("rally 3 complete"). The
 * 42nd practice is rally 1, the 63rd is rally 2, etc. */
export function rallyNumber(milestone: number): number {
  return Math.round((milestone - GATE_DAY) / GATE_DAY);
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

/** Whether THIS member should be routed to the full-screen ceremony right
 * now — true only for the very first qualifying open
 * (myLastCelebratedDay < GATE_DAY). Once seen, mark_celebration_seen
 * bumps last_celebrated_day to 21 so this goes false for good, even if
 * the circle is still unanswered — the quiet persistent card on the
 * circle screen takes over from there instead of re-blocking.
 *
 * PA1 — DELIBERATE INTERIM STATE, flagged rather than fixed here: the
 * threshold is now the member's own 21st PRACTICE, not the circle's day
 * 21, because the number handed in changed. That is an improvement, not
 * a regression — it stops the false ceremonies immediately (nobody in
 * the live cohort has 21 practices, so nothing fires today). The gate
 * itself, and its "21 days together" copy, are PA2's to remove. */
export function shouldShowJourneyGate(
  rallyCount: number,
  circle: { completedAt: string | null },
  myLastCelebratedDay: number
): boolean {
  return rallyCount >= GATE_DAY && !circle.completedAt && myLastCelebratedDay < GATE_DAY;
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
