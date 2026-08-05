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
    expect(successTitleFor({ glowMilestone: null, rallyCount: 40, isDayComplete: true })).toBe(
      STRINGS.checkinSuccessTitle(40)
    );
  });

  it('renders NO title at all when the count failed to load — never "day 1 done"', () => {
    expect(
      successTitleFor({ glowMilestone: null, rallyCount: null, isDayComplete: true })
    ).toBeNull();
    expect(
      successTitleFor({ glowMilestone: null, rallyCount: null, isDayComplete: true })
    ).not.toBe(STRINGS.checkinSuccessTitle(1));
    // …and an unresolved day-close read cannot resurrect it either: no
    // number means no headline, whatever else is or isn't known.
    expect(
      successTitleFor({ glowMilestone: null, rallyCount: null, isDayComplete: null })
    ).toBeNull();
  });

  it('day one itself still says day one — the fix removed a FALLBACK, not a number', () => {
    expect(successTitleFor({ glowMilestone: null, rallyCount: 1, isDayComplete: true })).toBe(
      STRINGS.checkinSuccessTitle(1)
    );
  });

  it('a milestone outranks the count, and needs no count of its own', () => {
    expect(
      successTitleFor({ glowMilestone: 21, rallyCount: null, isDayComplete: true })
    ).toBe(STRINGS.glowMilestoneTitle(21));
    expect(successTitleFor({ glowMilestone: 21, rallyCount: 40, isDayComplete: true })).toBe(
      STRINGS.glowMilestoneTitle(21)
    );
  });
});

/**
 * DD1 (5 Aug, Cat's ruling from her 03:48 screenshot) — "day 12 done"
 * printed directly above a button reading "one more today". The claim was
 * about the DAY; the screen fires on every check-in.
 *
 * These pin all four sides of the rule, so a later edit cannot quietly
 * hand the word back to a mid-day check-in.
 */
describe('DD1 — "done" waits for the day’s last check-in', () => {
  it('MID-DAY, another circle still waiting: the count alone, no claim', () => {
    expect(successTitleFor({ glowMilestone: null, rallyCount: 12, isDayComplete: false })).toBe(
      STRINGS.checkinSuccessTitleOpen(12)
    );
    expect(
      successTitleFor({ glowMilestone: null, rallyCount: 12, isDayComplete: false })
    ).not.toContain('done');
  });

  it('THE DAY’S LAST check-in keeps the full "day N done"', () => {
    expect(successTitleFor({ glowMilestone: null, rallyCount: 12, isDayComplete: true })).toBe(
      STRINGS.checkinSuccessTitle(12)
    );
    expect(successTitleFor({ glowMilestone: null, rallyCount: 12, isDayComplete: true })).toBe(
      'day 12 done'
    );
  });

  it('SOLO / single circle always gets "done" — their only check-in is the last', () => {
    // getDayCloseState short-circuits `active.length <= 1` to complete
    // without any presence fetch (OD1 job 9c), so this is the value a
    // single-circle person's screen actually holds. Their flow is
    // untouched by DD1.
    expect(successTitleFor({ glowMilestone: null, rallyCount: 3, isDayComplete: true })).toBe(
      STRINGS.checkinSuccessTitle(3)
    );
  });

  it('STILL RESOLVING reads as not-done — the line that cannot be wrong', () => {
    // Same instinct as FF2 above and as the CTA's own null branch ("never
    // guess at a farewell"): "day 12" is true either way, "day 12 done"
    // is only true sometimes. The headline may GAIN the word when the
    // read lands; it may never lose it in front of the person.
    expect(successTitleFor({ glowMilestone: null, rallyCount: 12, isDayComplete: null })).toBe(
      STRINGS.checkinSuccessTitleOpen(12)
    );
  });

  it('a milestone is untouched — it makes no day-done claim to withdraw', () => {
    expect(
      successTitleFor({ glowMilestone: 21, rallyCount: 21, isDayComplete: false })
    ).toBe(STRINGS.glowMilestoneTitle(21));
  });

  it('the open headline is the closed one minus exactly the claim', () => {
    // Pins the pair as a pair: same count, same casing, one word apart.
    // A future copy edit that drifts them into two different sentences
    // fails here rather than on Cat's phone.
    expect(`${STRINGS.checkinSuccessTitleOpen(7)} done`).toBe(STRINGS.checkinSuccessTitle(7));
  });
});
