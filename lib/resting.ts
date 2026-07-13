import { daysBetween } from './date';

/** RS1 (Rally21-Glow-Spec.md, 13 July, Cat: "i dont want the circle to
 * feel dead ever") — a circle-mate quietly fades to the edge of the
 * huddle after this many quiet days, rather than the circle ever reading
 * as dead or the member ever being auto-dropped. Purely derived, never
 * stored: returns instantly the moment they check in again, zero writes.
 *
 * This is a per-MEMBER concept, distinct from lib/signal.ts's
 * SignalState (which happens to also use the word "resting" for a whole
 * CIRCLE's aggregate check-in rate) — the two never interact.
 */
export const RESTING_QUIET_DAYS_THRESHOLD = 5;

/** After this many CONSECUTIVE resting days in one circle, the one warm
 * rejoin email fires (see compose-nudges' rest_rejoin kind). */
export const REJOIN_EMAIL_QUIET_DAYS_THRESHOLD = 14;

/** A new joiner is never born resting, regardless of how quiet they've
 * been, until they've actually been a member for more than the quiet-day
 * threshold — otherwise everyone would start every circle "resting". */
export function isResting(params: {
  joinedLocalDate: string;
  /** This member's own completion dates in THIS circle, any kind (self
   * or covered — a covered day counts as presence, it's a gift). */
  presenceLocalDates: string[];
  today: string;
}): boolean {
  const { joinedLocalDate, presenceLocalDates, today } = params;

  if (daysBetween(joinedLocalDate, today) <= RESTING_QUIET_DAYS_THRESHOLD) return false;

  const lastCompletion =
    presenceLocalDates.length > 0 ? [...presenceLocalDates].sort().at(-1)! : null;
  const daysSinceLastCompletion = lastCompletion ? daysBetween(lastCompletion, today) : Infinity;

  return daysSinceLastCompletion >= RESTING_QUIET_DAYS_THRESHOLD;
}
