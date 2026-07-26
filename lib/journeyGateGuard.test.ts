import { shouldShowJourneyGate } from './journey';
import {
  hasShownJourneyGate,
  markJourneyGateShown,
  resetJourneyGateGuardForTests,
  shouldRouteToJourneyGate,
} from './journeyGateGuard';

/**
 * CB1 job 1b — proving the cycle cannot re-form.
 *
 * THE LIVE TRAP (Cat's device, 25 July): the day-21 ceremony's only exit
 * in the rallied branch went to /circle, and circle.tsx pushed straight
 * back on the SAME eligibility check. It stayed shut because eligibility
 * depends entirely on last_celebrated_day, and the one write that
 * advances it was fire-and-forget behind a silent catch.
 *
 * Fixing the destination alone is NOT enough — Today routes to the
 * ceremony on exactly the same check, so an exit to Today would bounce
 * back the moment Today refocused. These cases pin the guard that makes
 * an exit terminal: shown-once, never routed again, whatever the server
 * did or didn't record.
 */

const RALLIED_CIRCLE = { completedAt: null };
const CIRCLE_ID = 'circle-1';
const DAY_21 = 21;
/** The live exposure class: rallied circle, marker write never landed. */
const MARKER_NEVER_WROTE = 0;

beforeEach(() => {
  resetJourneyGateGuardForTests();
});

describe('shouldRouteToJourneyGate — the routing decision', () => {
  it('routes to the ceremony on the first qualifying open', () => {
    expect(
      shouldRouteToJourneyGate(CIRCLE_ID, DAY_21, RALLIED_CIRCLE, MARKER_NEVER_WROTE)
    ).toBe(true);
  });

  it('NEVER routes again once the ceremony has been shown, even though the marker write failed', () => {
    expect(
      shouldRouteToJourneyGate(CIRCLE_ID, DAY_21, RALLIED_CIRCLE, MARKER_NEVER_WROTE)
    ).toBe(true);

    // What journey-gate.tsx does on mount, before any network call.
    markJourneyGateShown(CIRCLE_ID);

    // The server still says day 0 — eligibility is unchanged and still
    // true. Routing is what must stop, and does.
    expect(shouldShowJourneyGate(DAY_21, RALLIED_CIRCLE, MARKER_NEVER_WROTE)).toBe(true);
    expect(
      shouldRouteToJourneyGate(CIRCLE_ID, DAY_21, RALLIED_CIRCLE, MARKER_NEVER_WROTE)
    ).toBe(false);
  });

  it('closes the cycle for EVERY screen that routes in, not just the one that opened it', () => {
    // circle.tsx opens the ceremony...
    expect(
      shouldRouteToJourneyGate(CIRCLE_ID, DAY_21, RALLIED_CIRCLE, MARKER_NEVER_WROTE)
    ).toBe(true);
    markJourneyGateShown(CIRCLE_ID);

    // ...the exit lands on Today, which asks the same question on focus,
    // and would push straight back if it were asking eligibility alone.
    // Both callers share this one guard, so both stop.
    for (let refocus = 0; refocus < 5; refocus += 1) {
      expect(
        shouldRouteToJourneyGate(CIRCLE_ID, DAY_21, RALLIED_CIRCLE, MARKER_NEVER_WROTE)
      ).toBe(false);
    }
  });

  it('is per-circle: a second circle at its own day 21 still gets its ceremony', () => {
    markJourneyGateShown(CIRCLE_ID);
    expect(
      shouldRouteToJourneyGate('circle-2', DAY_21, RALLIED_CIRCLE, MARKER_NEVER_WROTE)
    ).toBe(true);
    expect(hasShownJourneyGate('circle-2')).toBe(false);
  });

  it('leaves eligibility exactly as it was — an ineligible circle is still ineligible', () => {
    expect(shouldRouteToJourneyGate(CIRCLE_ID, 20, RALLIED_CIRCLE, MARKER_NEVER_WROTE)).toBe(false);
    expect(
      shouldRouteToJourneyGate(CIRCLE_ID, DAY_21, { completedAt: '2026-07-25' }, MARKER_NEVER_WROTE)
    ).toBe(false);
    expect(shouldRouteToJourneyGate(CIRCLE_ID, DAY_21, RALLIED_CIRCLE, 21)).toBe(false);
  });
});
