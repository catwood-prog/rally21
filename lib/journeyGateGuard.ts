import { shouldShowJourneyGate } from './journey';

/**
 * CB1 job 1b — the ROUTING guard for the day-21 ceremony, deliberately
 * separate from `shouldShowJourneyGate`'s ELIGIBILITY rule (which PA1/PA2
 * own and this file never touches).
 *
 * THE TRAP THIS EXISTS TO CLOSE (found live on Cat's device, 25 July):
 * eligibility is a pure function of `last_celebrated_day`, and the only
 * thing that ever advances that column is `markCelebrationSeen` — one
 * fire-and-forget RPC. If that write fails, every screen that routes to
 * the ceremony keeps evaluating "yes, show it", so the ceremony can be
 * re-entered by the very screen it exits to. Fixing the exit's
 * destination alone would NOT close the cycle: Today pushes the gate on
 * exactly the same check the circle screen does, so an exit to Today
 * would bounce straight back.
 *
 * So: showing the ceremony is recorded HERE, in the client, the moment
 * the screen mounts — before any network call, and regardless of whether
 * the server ever hears about it. Every route INTO the ceremony goes
 * through `shouldRouteToJourneyGate`, which is false forever after that.
 * The cycle cannot re-form because the guard is set on the way IN, not
 * on the way out.
 *
 * Scope of the record: this app session only. That is the right amount —
 * the durable record is `last_celebrated_day`, and this is only the
 * stopgap for the window where that write has failed. A relaunch after a
 * genuinely failed write shows the ceremony once more (a re-show, which
 * has a working exit), never a trap.
 */
const shownThisSession = new Set<string>();

/** Called by the ceremony screen itself, on mount, before it fetches
 * anything — a screen that got as far as rendering has been shown. */
export function markJourneyGateShown(circleId: string): void {
  shownThisSession.add(circleId);
}

export function hasShownJourneyGate(circleId: string): boolean {
  return shownThisSession.has(circleId);
}

/** The one question every screen that can route to the ceremony must ask
 * — never `shouldShowJourneyGate` directly. */
export function shouldRouteToJourneyGate(
  circleId: string,
  rallyCount: number,
  circle: { completedAt: string | null },
  myLastCelebratedDay: number
): boolean {
  if (hasShownJourneyGate(circleId)) return false;
  return shouldShowJourneyGate(rallyCount, circle, myLastCelebratedDay);
}

/** Tests only — module state would otherwise leak between cases. */
export function resetJourneyGateGuardForTests(): void {
  shownThisSession.clear();
}
