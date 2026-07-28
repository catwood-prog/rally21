import {
  countRallyDays,
  GATE_DAY,
  getJourneyLeg,
  getNextMilestone,
  rallyNumber,
  shouldShowJourneyGate,
} from './journey';

/**
 * PA1 — THE COUNT. Every number in this app's milestone ladder is now a
 * count of practices, so these cases are the ladder's foundation.
 *
 * The fixtures are modelled on the LIVE cohort as it stood on 27 July,
 * because both of the traps this section exists to close were found in
 * real rows rather than in the abstract: a user-level count with no
 * circle filter, and covered days inflating a personal number.
 */
const ME = 'user-me';
const FRIEND = 'user-friend';

type Row = { userId: string; localDate: string; kind: 'self' | 'covered' };
const self = (userId: string, localDate: string): Row => ({ userId, localDate, kind: 'self' });
const covered = (userId: string, localDate: string): Row => ({
  userId,
  localDate,
  kind: 'covered',
});

describe('countRallyDays — PA1 job 1', () => {
  test('a day-0 joiner: every practice since the circle began is theirs', () => {
    // Joined on the start date and practised on 5 of the first 6 days.
    const presence = [
      self(ME, '2026-07-04'),
      self(ME, '2026-07-05'),
      self(ME, '2026-07-06'),
      self(ME, '2026-07-08'),
      self(ME, '2026-07-09'),
    ];
    expect(countRallyDays(presence, ME)).toBe(5);
  });

  test('a day-14 joiner reads their OWN practices, not the circle’s age', () => {
    // The live case that started the memo: Cathy S joined Breath of Fire
    // on 18 July, fourteen days into a circle that started on 4 July. On
    // circle-day 24 she had practised 7 times. The old number handed her
    // a 21-day ceremony; the rally count says 7.
    const presence = [
      // The circle's first two weeks, before she arrived — all someone else's.
      ...Array.from({ length: 14 }, (_, i) =>
        self(FRIEND, `2026-07-${String(4 + i).padStart(2, '0')}`)
      ),
      self(ME, '2026-07-18'),
      self(ME, '2026-07-19'),
      self(ME, '2026-07-20'),
      self(ME, '2026-07-22'),
      self(ME, '2026-07-23'),
      self(ME, '2026-07-25'),
      self(ME, '2026-07-26'),
    ];
    expect(countRallyDays(presence, ME)).toBe(7);
  });

  test('more elapsed days than practices: the count never borrows from the calendar', () => {
    // 24 days have passed; this member showed up on 8 of them. The
    // circle-day number said 24 (capped to 21); the rally says 8.
    const presence = Array.from({ length: 8 }, (_, i) =>
      self(ME, `2026-07-${String(4 + i * 3).padStart(2, '0')}`)
    );
    expect(countRallyDays(presence, ME)).toBe(8);
    expect(countRallyDays(presence, ME)).toBeLessThan(24);
  });

  test('TRAP (b): covered days protect the glow and NEVER advance the rally', () => {
    // Live proof, 27 July: Catherine S in Stretching/Yoga had 6 self days
    // and 5 covered. A rule that counted covers reports 11 instead of 6 —
    // re-inflating the number exactly as the circle-day number did.
    const presence = [
      ...Array.from({ length: 6 }, (_, i) =>
        self(ME, `2026-07-${String(5 + i).padStart(2, '0')}`)
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        covered(ME, `2026-07-${String(12 + i).padStart(2, '0')}`)
      ),
    ];
    expect(countRallyDays(presence, ME)).toBe(6);
    expect(countRallyDays(presence, ME)).not.toBe(11);
  });

  test('a member covered on every single day has a rally of zero', () => {
    // The starkest form of the same rule: a friend saying "I've got you"
    // is never a practice you did, however often they say it.
    const presence = Array.from({ length: 21 }, (_, i) =>
      covered(ME, `2026-07-${String(1 + i).padStart(2, '0')}`)
    );
    expect(countRallyDays(presence, ME)).toBe(0);
    expect(shouldShowJourneyGate(countRallyDays(presence, ME), { completedAt: null }, 0)).toBe(
      false
    );
  });

  test('TRAP (a): only THIS member’s rows count, never a circle-mate’s', () => {
    const presence = [
      self(FRIEND, '2026-07-05'),
      self(FRIEND, '2026-07-06'),
      self(ME, '2026-07-05'),
      self(FRIEND, '2026-07-07'),
    ];
    expect(countRallyDays(presence, ME)).toBe(1);
    expect(countRallyDays(presence, FRIEND)).toBe(3);
  });

  test('TRAP (a): a rally in one circle is unmoved by practice in another', () => {
    // The helper is handed ONE circle's presence rows, so a second
    // circle's practice is not merely filtered out — it is never in
    // scope. This is the structural reason the memo forbids reusing
    // glow_qualifying_days, which is user-level with no circle filter.
    // Modelled on Catherine S, live in three circles at 8, 9 and 6.
    const circleA = Array.from({ length: 8 }, (_, i) =>
      self(ME, `2026-07-${String(4 + i).padStart(2, '0')}`)
    );
    const circleB = Array.from({ length: 9 }, (_, i) =>
      self(ME, `2026-07-${String(3 + i).padStart(2, '0')}`)
    );
    expect(countRallyDays(circleA, ME)).toBe(8);
    expect(countRallyDays(circleB, ME)).toBe(9);
    // And the naive user-level rule the memo warns about would have
    // reported 17 for both.
    expect(countRallyDays([...circleA, ...circleB], ME)).not.toBe(8);
  });

  test('counts DISTINCT local dates, so a duplicated row cannot inflate it', () => {
    const presence = [self(ME, '2026-07-05'), self(ME, '2026-07-05'), self(ME, '2026-07-06')];
    expect(countRallyDays(presence, ME)).toBe(2);
  });

  test('nobody in the live cohort reaches 21 on a correct count', () => {
    // The cohort's best record on 27 July is 18 self days (Russ). The
    // acceptance test from memo §9: no ceremony may fire for a practice
    // count the person has not reached.
    const best = Array.from({ length: 18 }, (_, i) =>
      self(ME, `2026-07-${String(5 + i).padStart(2, '0')}`)
    );
    expect(countRallyDays(best, ME)).toBe(18);
    expect(shouldShowJourneyGate(countRallyDays(best, ME), { completedAt: null }, 0)).toBe(false);
    expect(getNextMilestone(countRallyDays(best, ME), 0)).toBeNull();
  });
});

describe('the monotonic contract, re-proved in practice counts', () => {
  test('a skipped milestone cannot re-fire after a newer one', () => {
    // 42, 63 and the 50 major stop all became eligible during a gap.
    // Only the most recent fires...
    expect(getNextMilestone(70, 0)).toEqual({ day: 63, isMajorStop: false });
    // ...and once it is marked, the older ones stay gone for good.
    expect(getNextMilestone(70, 63)).toBeNull();
    expect(getNextMilestone(70, 63)).not.toEqual({ day: 50, isMajorStop: true });
  });

  test('an older milestone can never regress the tracker', () => {
    // getNextMilestone only ever returns something STRICTLY above the
    // tracker, so no caller can be handed a day that walks it backwards.
    for (const lastCelebrated of [21, 42, 50, 63, 100]) {
      const next = getNextMilestone(120, lastCelebrated);
      expect(next).not.toBeNull();
      expect(next!.day).toBeGreaterThan(lastCelebrated);
    }
    expect(getNextMilestone(120, 105)).toBeNull();
  });

  test('the reset to 0 does not re-fire anything for the live cohort', () => {
    // What the PA1 migration does: six rows holding a circle-day 21 go
    // to 0. With counts of 8, 7, 9, 6, 3 and 18, nothing becomes
    // eligible — not the gate, not a quiet celebration.
    for (const count of [8, 7, 9, 6, 3, 18]) {
      expect(shouldShowJourneyGate(count, { completedAt: null }, 0)).toBe(false);
      expect(getNextMilestone(count, 0)).toBeNull();
    }
    // And the first thing that WILL fire, when someone earns it:
    expect(shouldShowJourneyGate(GATE_DAY, { completedAt: null }, 0)).toBe(true);
  });
});

describe('getJourneyLeg', () => {
  test('below 50 targets 50', () => {
    expect(getJourneyLeg(22)).toEqual({ targetDay: 50, label: 'rallying to 50' });
    expect(getJourneyLeg(42)).toEqual({ targetDay: 50, label: 'rallying to 50' });
  });

  test('50 up to 100 targets 100', () => {
    expect(getJourneyLeg(50)).toEqual({ targetDay: 100, label: 'rallying to 100' });
    expect(getJourneyLeg(99)).toEqual({ targetDay: 100, label: 'rallying to 100' });
  });

  test('100 up to 365 targets 365', () => {
    expect(getJourneyLeg(100)).toEqual({ targetDay: 365, label: 'rallying to 365' });
    expect(getJourneyLeg(364)).toEqual({ targetDay: 365, label: 'rallying to 365' });
  });

  test('365 and beyond has no further target', () => {
    expect(getJourneyLeg(365)).toEqual({ targetDay: null, label: 'rallying on' });
    expect(getJourneyLeg(400)).toEqual({ targetDay: null, label: 'rallying on' });
  });
});

describe('rallyNumber', () => {
  test('day 42 is rally 1, day 63 is rally 2', () => {
    expect(rallyNumber(42)).toBe(1);
    expect(rallyNumber(63)).toBe(2);
    expect(rallyNumber(84)).toBe(3);
  });
});

describe('getNextMilestone', () => {
  test('nothing to celebrate before the first rally marker', () => {
    expect(getNextMilestone(30, 0)).toBeNull();
  });

  test('the first rally marker at day 42', () => {
    expect(getNextMilestone(42, 0)).toEqual({ day: 42, isMajorStop: false });
  });

  test('already celebrated — never re-fires for the same day', () => {
    expect(getNextMilestone(42, 42)).toBeNull();
  });

  test('major stop at 50 outranks a same-range rally marker', () => {
    // 42 is a rally marker candidate, 50 is a major stop — both <= 50,
    // but only the most recent (50) should be returned.
    expect(getNextMilestone(50, 0)).toEqual({ day: 50, isMajorStop: true });
  });

  test('several skipped milestones collapse to just the most recent one', () => {
    // Gap of many days away: rally markers 42/63/84/105 and major stop
    // 100 are all newly eligible — only the most recent (105) should
    // surface, never a backlog.
    expect(getNextMilestone(110, 0)).toEqual({ day: 105, isMajorStop: false });
  });

  test('365 is a major stop', () => {
    expect(getNextMilestone(365, 100)).toEqual({ day: 365, isMajorStop: true });
  });
});

describe('shouldShowJourneyGate', () => {
  const openCircle = { completedAt: null };
  const completedCircle = { completedAt: '2026-07-01T00:00:00Z' };

  test('never before day 21', () => {
    expect(shouldShowJourneyGate(20, openCircle, 0)).toBe(false);
  });

  test('shows at day 21 for a member who has not seen it yet', () => {
    expect(shouldShowJourneyGate(21, openCircle, 0)).toBe(true);
  });

  test('still shows past day 21 if unseen (never re-blocks once seen, but does not miss it either)', () => {
    expect(shouldShowJourneyGate(25, openCircle, 0)).toBe(true);
  });

  test('never shows again once this member has seen it', () => {
    expect(shouldShowJourneyGate(25, openCircle, 21)).toBe(false);
  });

  test('never shows for an already-completed circle', () => {
    expect(shouldShowJourneyGate(25, completedCircle, 0)).toBe(false);
  });

  // PA2 — found by the disposable walk, not predicted. The ceremony's
  // answer path writes finish_my_rally FIRST and mark_celebration_seen
  // second, so a failure between the two leaves a member finished with
  // their marker still at 0 — and they were being routed straight back
  // into the ceremony that starts a rally they had just ended.
  test('never shows to a member who has FINISHED their rally here', () => {
    expect(shouldShowJourneyGate(25, openCircle, 0, '2026-07-27T00:00:00Z')).toBe(false);
    // ...including the exact half-written state that produced the bug:
    // finished, but the marker write never landed.
    expect(shouldShowJourneyGate(GATE_DAY, openCircle, 0, '2026-07-27T00:00:00Z')).toBe(false);
  });

  test('still shows to a member who has NOT finished (null and undefined both mean "not finished")', () => {
    expect(shouldShowJourneyGate(25, openCircle, 0, null)).toBe(true);
    expect(shouldShowJourneyGate(25, openCircle, 0, undefined)).toBe(true);
  });

  test('finishing does not resurrect a ceremony the member already answered', () => {
    expect(shouldShowJourneyGate(25, openCircle, 21, null)).toBe(false);
  });
});
