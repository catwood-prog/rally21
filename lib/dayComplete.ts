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
 * "Active" excludes a completed circle: it is read-only history with
 * nothing to do today (today.tsx skips its check-in flow entirely on
 * `circle.completedAt`), so a completed circle is never "awaiting".
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
  deps?: {
    listMyCircles: (userId: string) => Promise<MyCircle[]>;
    getCirclePresence: (
      circleId: string
    ) => Promise<{ userId: string; localDate: string }[]>;
  };
}): Promise<boolean> {
  const listCircles = params.deps?.listMyCircles ?? listMyCircles;
  const getPresence = params.deps?.getCirclePresence ?? getCirclePresence;

  const circles = await listCircles(params.userId);
  const active = circles.filter((c) => !c.completedAt);
  if (active.length <= 1) return true;

  const presences = await Promise.all(active.map((c) => getPresence(c.id)));
  return presences.every((presence) =>
    hasPresenceToday(presence, params.userId, params.localDate)
  );
}
