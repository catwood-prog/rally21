import { getCirclePresence, listMyCircles, MyCircle } from './circle';

// OD1 Job 9 (22 July) — "is the day done for this user?" There is exactly
// ONE definition of "done for today" in the app and it lives here, drawn
// from the SAME source Today reads (listMyCircles + getCirclePresence).
// Two definitions of done is how the share card fired mid-day in the
// first place (a per-check-in event dressed as an end-of-day one).

/** True when `presence` holds a row for this user on this date — the
 * single "done for this circle today" test, identical to Today's own
 * `inTodayUserIds.has(userId)` check (today.tsx ~490) over the same
 * completions rows. Covered days count as done: getCirclePresence returns
 * the covered member's OWN row (user_id = the covered member, kind
 * 'covered'), so a covered day reads as done here exactly as it does on
 * Today — which is Job 9a's "cover/covered days count as done for the
 * circle they cover." */
export function hasPresenceToday(
  presence: { userId: string; localDate: string }[],
  userId: string,
  localDate: string
): boolean {
  return presence.some((p) => p.userId === userId && p.localDate === localDate);
}

/** Job 9a — the day is done when NO active circle of this user is still
 * awaiting a self check-in today. The share card and the "see you
 * tomorrow" close may only fire once this is true.
 *
 * "Active" excludes a circle nobody is being asked to show up in today,
 * and there are three ways that happens — see ACTIVE FOR TODAY below
 * getDayCloseState, which is where the rule lives.
 *
 * A single active circle short-circuits to done WITHOUT any presence
 * fetch: this helper is called from the check-in-success flow, so the
 * user has, by construction, just checked into a circle — with only one
 * active circle there is nothing else to await. That is the proof behind
 * Job 9c (single-circle users are completely unaffected: the gate always
 * passes, so their card timing is byte-for-byte unchanged) and it costs
 * them zero extra network round-trips beyond the one circle-list read.
 *
 * `deps` is injectable purely so unit tests can substitute fakes without
 * network access (the resolveCircleSelection convention) — call sites
 * never pass it. */
export async function isEndOfDayComplete(params: {
  userId: string;
  localDate: string;
  deps?: DayCloseDeps;
}): Promise<boolean> {
  return (await getDayCloseState(params)).isComplete;
}

export type DayCloseDeps = {
  listMyCircles: (userId: string) => Promise<MyCircle[]>;
  getCirclePresence: (circleId: string) => Promise<{ userId: string; localDate: string }[]>;
};

export type DayCloseState = {
  /** Job 9a's gate, unchanged in meaning.
   *
   * DD1 (5 Aug) — this now also decides whether the celebration headline
   * is allowed to say the word "done" (see `successTitleFor` in
   * checkin-complete.tsx). Same value, same traversal, one more reader:
   * the headline, the button and the card gate cannot disagree about
   * whether the day is over, because there is nothing for them to
   * disagree with. */
  isComplete: boolean;
  /** OD1 job 9d — how many active circles are STILL awaiting a self
   * check-in today. Always 0 when isComplete, so the two can never
   * disagree. This is the count the closing beat says out loud
   * ("two more today"), and it comes from this traversal rather than a
   * second source precisely because 9d requires "still awaiting" to mean
   * the same thing everywhere it is asked. */
  awaitingCount: number;
};

/**
 * OD1 job 9d — the one traversal that answers BOTH questions the daily
 * close needs: is the day done, and if not, how much is left.
 *
 * Deriving the count here rather than anywhere else is the whole point.
 * The nearest server-side thing (`count_open_circles_by_practice`) counts
 * a completely different "open" — PUBLIC circles with room to join, for
 * the discovery grid — and would have been a second, wrong definition
 * wearing the right name.
 *
 * Costs nothing extra: isEndOfDayComplete already fetched every active
 * circle's presence to answer its own question; this counts the misses
 * instead of merely checking that there are none.
 *
 * ACTIVE FOR TODAY — the three ways a circle you belong to is not
 * awaiting anything (DD1, 5 Aug, tightened from the completedAt-only
 * test this shipped with):
 *
 *   ARCHIVED (`circle.completedAt`) — the creator ended it for everyone.
 *   Read-only history; today.tsx renders it as a settled card with no
 *   check-in flow at all.
 *
 *   FINISHED (`circle.myFinishedAt`) — PA2's personal ceremony: I ended
 *   MY rally here and stayed visible in a settled state. today.tsx is
 *   explicit that "a finished member is never asked to check in", and it
 *   skips the whole flow on this column — so counting it as awaiting was
 *   a live disagreement between two screens about the same person. It
 *   inflated "N more today", and it could hold the day open forever: a
 *   member who finishes one of two circles would never again reach a
 *   done day, so the share card and the farewell would simply stop.
 *
 *   AWAY (RS2's person-level pause) gets NO filter of its own here, and
 *   that absence is the decision rather than an omission — a second
 *   mechanism is exactly what this section was told not to build.
 *   `users.away_since` pauses the PERSON, not a circle, and it resolves
 *   in two halves, neither of which needs one. The LIVE half cannot
 *   reach this function: lib/checkin.ts's saveCompletion calls
 *   return_from_away() before the completion is even written, so a
 *   caller of this is never currently away. The RESOLVED half is already
 *   presence: return_from_away() backfills one 'away'-kind completions
 *   row per held day, and hasPresenceToday is kind-blind, so those days
 *   read as done here exactly as they do for the picker's per-row mark
 *   (lib/circle.ts's myStateInCircle — same decision, pinned in
 *   circle.test.ts, and the two must be tightened together if ever).
 *   The resolved half is pinned below.
 */
export async function getDayCloseState(params: {
  userId: string;
  localDate: string;
  deps?: DayCloseDeps;
}): Promise<DayCloseState> {
  const listCircles = params.deps?.listMyCircles ?? listMyCircles;
  const getPresence = params.deps?.getCirclePresence ?? getCirclePresence;

  const circles = await listCircles(params.userId);
  const active = circles.filter((c) => !c.completedAt && !c.myFinishedAt);
  // The single-circle short-circuit (Job 9c) is preserved exactly: the
  // caller has, by construction, just checked in, so with one active
  // circle there is nothing left to await and no presence fetch happens.
  if (active.length <= 1) return { isComplete: true, awaitingCount: 0 };

  const presences = await Promise.all(active.map((c) => getPresence(c.id)));
  const awaitingCount = presences.filter(
    (presence) => !hasPresenceToday(presence, params.userId, params.localDate)
  ).length;
  return { isComplete: awaitingCount === 0, awaitingCount };
}
