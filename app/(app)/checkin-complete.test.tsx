import { STRINGS } from '@/constants/strings';

import { successTitleFor } from './checkin-complete';

/**
 * FF2 (28 July), from FF1's inventory — the check-in success title used to
 * be `STRINGS.checkinSuccessTitle(rallyCount ?? 1)`. The count comes from a
 * fetch whose failure was swallowed, so any hiccup told a person on their
 * fortieth day "day 1 done": a fabricated person-facing number, the exact
 * shape PA4 shipped and had to repair at the RPC boundary.
 *
 * These pin the rule that replaced it — compose the number only when it is
 * KNOWN — so a future edit cannot quietly reintroduce a fallback.
 */
describe('the check-in success title never invents a number', () => {
  it('composes the day count when the count is known', () => {
    expect(successTitleFor({ glowMilestone: null, rallyCount: 40 })).toBe(
      STRINGS.checkinSuccessTitle(40)
    );
  });

  it('renders NO title at all when the count failed to load — never "day 1 done"', () => {
    expect(successTitleFor({ glowMilestone: null, rallyCount: null })).toBeNull();
    expect(successTitleFor({ glowMilestone: null, rallyCount: null })).not.toBe(
      STRINGS.checkinSuccessTitle(1)
    );
  });

  it('day one itself still says day one — the fix removed a FALLBACK, not a number', () => {
    expect(successTitleFor({ glowMilestone: null, rallyCount: 1 })).toBe(
      STRINGS.checkinSuccessTitle(1)
    );
  });

  it('a milestone outranks the count, and needs no count of its own', () => {
    expect(successTitleFor({ glowMilestone: 21, rallyCount: null })).toBe(
      STRINGS.glowMilestoneTitle(21)
    );
    expect(successTitleFor({ glowMilestone: 21, rallyCount: 40 })).toBe(
      STRINGS.glowMilestoneTitle(21)
    );
  });
});
