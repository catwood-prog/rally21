import { getJourneyLeg, getNextMilestone, rallyNumber, shouldShowJourneyGate } from './journey';

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
});
