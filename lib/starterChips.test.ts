/**
 * PM1B (21 July): the missed-day recovery chip's gate and the chip-set
 * order. The hard rule under test: "how do I get back on track?" must
 * NEVER render for a user who checked in (or was covered) yesterday, and
 * never for a user with no yesterday to miss — a false "you lapsed"
 * signal is the one failure mode this feature cannot have.
 */
import { STRINGS } from '@/constants/strings';

import { WeekDay, WeekDayState } from './glow';
import { buildStarterChips, missedYesterday } from './starterChips';

/** Oldest-first week row ending today, matching getMyWeek's shape. */
function week(...states: WeekDayState[]): WeekDay[] {
  return states.map((state, i) => ({ date: `2026-07-${String(10 + i).padStart(2, '0')}`, state }));
}

describe('missedYesterday — the recovery chip gate', () => {
  it('true when yesterday reads none after real practice earlier in the week', () => {
    expect(missedYesterday(week('earned', 'earned', 'none', 'none'))).toBe(true);
    expect(missedYesterday(week('earned', 'none', 'earned'))).toBe(true);
  });

  it('a held (covered) day earlier in the week also counts as practice history', () => {
    expect(missedYesterday(week('held', 'none', 'none'))).toBe(true);
  });

  it('false when the user checked in yesterday — the forbidden false-lapse case', () => {
    expect(missedYesterday(week('none', 'earned', 'none'))).toBe(false);
    expect(missedYesterday(week('earned', 'earned', 'earned'))).toBe(false);
  });

  it('false when a friend covered yesterday — held is not a miss', () => {
    expect(missedYesterday(week('earned', 'held', 'none'))).toBe(false);
  });

  it('false for a brand-new user whose week shows no practice at all (no yesterday to miss)', () => {
    expect(missedYesterday(week('none', 'none', 'none'))).toBe(false);
    // first-ever check-in today: still no yesterday to miss
    expect(missedYesterday(week('none', 'none', 'earned'))).toBe(false);
  });

  it('false when there is no yesterday row at all (mid-onboarding / day 1)', () => {
    expect(missedYesterday([])).toBe(false);
    expect(missedYesterday(week('earned'))).toBe(false);
  });
});

describe('buildStarterChips — Cat-approved order, both states', () => {
  it('a standard day renders the four ruled chips verbatim, in order', () => {
    expect(buildStarterChips(false)).toEqual([
      'what are you noticing about me?',
      "what's getting in my way lately?",
      'am I expecting too much of myself?',
      "I want to talk about how I'm feeling",
    ]);
  });

  it('a missed-yesterday day swaps the recovery chip into slot 2 — four chips, never five', () => {
    const chips = buildStarterChips(true);
    expect(chips).toEqual([
      'what are you noticing about me?',
      'how do I get back on track?',
      'am I expecting too much of myself?',
      "I want to talk about how I'm feeling",
    ]);
    expect(chips).toHaveLength(4);
  });

  it('the recovery chip never appears on a standard day', () => {
    expect(buildStarterChips(false)).not.toContain(STRINGS.askRallyRecoveryChip);
  });

  it('never mutates the source chip set', () => {
    buildStarterChips(true);
    expect(STRINGS.blueprintAskChips[1]).toBe("what's getting in my way lately?");
  });
});
