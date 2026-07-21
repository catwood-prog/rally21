/**
 * PM1B (21 July): the missed-day recovery chip's gate and the chip-set
 * order. The hard rule under test: "how do I get back on track?" must
 * NEVER render for a user who checked in (or was covered) yesterday, and
 * never for a user with no yesterday to miss — a false "you lapsed"
 * signal is the one failure mode this feature cannot have.
 *
 * PM1C (21 July): the personal chip — template table pinned per pattern
 * type, the evidence gate at/below its thresholds (evidenceRate >= 0.6,
 * the 'fairly sure' floor; agreementCount >= 5, B1's smallest sample
 * floor), per-day determinism, and displacement order with and without
 * the recovery chip. Its forbidden failure mode: a false or creepy
 * inference — when in doubt, nothing personal.
 */
import { STRINGS } from '@/constants/strings';

import { BlueprintPattern } from './blueprint';
import { WeekDay, WeekDayState } from './glow';
import { buildStarterChips, derivePersonalChip, missedYesterday } from './starterChips';

/** Oldest-first week row ending today, matching getMyWeek's shape. */
function week(...states: WeekDayState[]): WeekDay[] {
  return states.map((state, i) => ({ date: `2026-07-${String(10 + i).padStart(2, '0')}`, state }));
}

function pattern(overrides: Partial<BlueprintPattern>): BlueprintPattern {
  return {
    patternKey: 'weekday_1_low',
    patternType: 'weekday_mood',
    weekday: 1,
    direction: 'low',
    cutoffHour: null,
    agreementCount: 6,
    totalCount: 8,
    evidenceRate: 0.75,
    statement: null,
    ...overrides,
  };
}

const UID = 'user-1';
const DAY = '2026-07-21';

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

describe('derivePersonalChip — the template table, pinned per pattern type', () => {
  it('weekday_mood low → "run me down", lowercase weekday', () => {
    expect(derivePersonalChip([pattern({})], UID, DAY)).toBe('why do mondays run me down?');
  });

  it('weekday_mood high → "lift me up"', () => {
    expect(
      derivePersonalChip([pattern({ patternKey: 'weekday_5_high', weekday: 5, direction: 'high' })], UID, DAY)
    ).toBe('why do fridays lift me up?');
  });

  it('time_of_day_mood, both directions', () => {
    expect(
      derivePersonalChip(
        [pattern({ patternKey: 't1', patternType: 'time_of_day_mood', weekday: null, direction: 'before_noon_higher', agreementCount: 8, totalCount: 12, evidenceRate: 0.667 })],
        UID,
        DAY
      )
    ).toBe('why am I brighter before noon?');
    expect(
      derivePersonalChip(
        [pattern({ patternKey: 't2', patternType: 'time_of_day_mood', weekday: null, direction: 'after_noon_higher', agreementCount: 8, totalCount: 12, evidenceRate: 0.667 })],
        UID,
        DAY
      )
    ).toBe('why am I brighter later in the day?');
  });

  it('consistency → the cutoff-hour label, shared with the pattern card', () => {
    expect(
      derivePersonalChip(
        [pattern({ patternKey: 'consistency', patternType: 'consistency', weekday: null, direction: null, cutoffHour: 9, agreementCount: 8, totalCount: 12, evidenceRate: 0.667 })],
        UID,
        DAY
      )
    ).toBe('why does checking in before 9am work for me?');
  });

  it('synthesis patterns never produce a chip — no template, by design', () => {
    expect(
      derivePersonalChip(
        [pattern({ patternKey: 's1', patternType: 'synthesis_pattern', weekday: null, direction: null, agreementCount: 99, totalCount: 99, evidenceRate: 0.99, statement: 'model prose' })],
        UID,
        DAY
      )
    ).toBeNull();
  });

  it('every template is lowercase-styled, first-person, and ends with "?"', () => {
    const all = [
      STRINGS.personalChipWeekdayLow('mondays'),
      STRINGS.personalChipWeekdayHigh('fridays'),
      STRINGS.personalChipBeforeNoon,
      STRINGS.personalChipAfterNoon,
      STRINGS.personalChipConsistency('9am'),
    ];
    for (const q of all) {
      expect(q.endsWith('?')).toBe(true);
      expect(q[0]).toBe(q[0].toLowerCase());
      expect(/\b(me|my|I)\b/.test(q)).toBe(true);
    }
  });
});

describe('derivePersonalChip — the evidence gate', () => {
  it('renders at exactly the thresholds (rate 0.6, agreement 5)', () => {
    expect(
      derivePersonalChip([pattern({ agreementCount: 5, totalCount: 8, evidenceRate: 0.6 })], UID, DAY)
    ).toBe('why do mondays run me down?');
  });

  it('nothing personal below the fairly-sure rate floor', () => {
    expect(
      derivePersonalChip([pattern({ agreementCount: 5, totalCount: 9, evidenceRate: 0.556 })], UID, DAY)
    ).toBeNull();
  });

  it('nothing personal below the minimum agreeing check-ins', () => {
    expect(
      derivePersonalChip([pattern({ agreementCount: 4, totalCount: 5, evidenceRate: 0.8 })], UID, DAY)
    ).toBeNull();
  });

  it('nothing personal with no patterns or no user', () => {
    expect(derivePersonalChip([], UID, DAY)).toBeNull();
    expect(derivePersonalChip([pattern({})], '', DAY)).toBeNull();
  });
});

describe('derivePersonalChip — deterministic per user per day', () => {
  const two = [
    pattern({}),
    pattern({ patternKey: 'consistency', patternType: 'consistency', weekday: null, direction: null, cutoffHour: 9, agreementCount: 8, totalCount: 12, evidenceRate: 0.667 }),
  ];

  it('same user, same day, same chip — every call', () => {
    const first = derivePersonalChip(two, UID, DAY);
    for (let i = 0; i < 5; i++) expect(derivePersonalChip(two, UID, DAY)).toBe(first);
    expect(derivePersonalChip([...two].reverse(), UID, DAY)).toBe(first);
  });

  it('always one of the qualifying questions', () => {
    const valid = ['why do mondays run me down?', 'why does checking in before 9am work for me?'];
    expect(valid).toContain(derivePersonalChip(two, UID, DAY));
    expect(valid).toContain(derivePersonalChip(two, UID, '2026-07-22'));
    expect(valid).toContain(derivePersonalChip(two, 'user-2', DAY));
  });
});

describe('buildStarterChips — Cat-approved order, all four states', () => {
  const texts = (chips: ReturnType<typeof buildStarterChips>) => chips.map((c) => c.text);
  const PERSONAL = 'why do mondays run me down?';

  it('a standard day renders the four ruled chips verbatim, in order', () => {
    const chips = buildStarterChips({ hasMissedYesterday: false });
    expect(texts(chips)).toEqual([
      'what are you noticing about me?',
      "what's getting in my way lately?",
      'am I expecting too much of myself?',
      "I want to talk about how I'm feeling",
    ]);
    expect(chips.every((c) => !c.personal)).toBe(true);
  });

  it('missed yesterday swaps the recovery chip into slot 2 — four chips, never five', () => {
    expect(texts(buildStarterChips({ hasMissedYesterday: true }))).toEqual([
      'what are you noticing about me?',
      'how do I get back on track?',
      'am I expecting too much of myself?',
      "I want to talk about how I'm feeling",
    ]);
  });

  it('the personal chip takes slot 1 and displaces "expecting too much" — the comp order', () => {
    const chips = buildStarterChips({ hasMissedYesterday: false, personalQuestion: PERSONAL });
    expect(texts(chips)).toEqual([
      PERSONAL,
      'what are you noticing about me?',
      "what's getting in my way lately?",
      "I want to talk about how I'm feeling",
    ]);
    expect(chips.map((c) => c.personal)).toEqual([true, false, false, false]);
  });

  it('personal + recovery together: recovery keeps its own rule, still four chips', () => {
    const chips = buildStarterChips({ hasMissedYesterday: true, personalQuestion: PERSONAL });
    expect(texts(chips)).toEqual([
      PERSONAL,
      'what are you noticing about me?',
      'how do I get back on track?',
      "I want to talk about how I'm feeling",
    ]);
    expect(chips).toHaveLength(4);
  });

  it('the recovery chip never appears on a standard day', () => {
    expect(texts(buildStarterChips({ hasMissedYesterday: false }))).not.toContain(
      STRINGS.askRallyRecoveryChip
    );
  });

  it('never mutates the source chip set', () => {
    buildStarterChips({ hasMissedYesterday: true, personalQuestion: PERSONAL });
    expect(STRINGS.blueprintAskChips[1]).toBe("what's getting in my way lately?");
    expect(STRINGS.blueprintAskChips[2]).toBe('am I expecting too much of myself?');
  });
});
