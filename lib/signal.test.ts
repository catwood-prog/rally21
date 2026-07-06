import { computeSignal, getTrailingLocalDates } from './signal';

describe('computeSignal', () => {
  test('day 1 — window is a single day, rate reflects just today', () => {
    const today = '2026-07-05';
    const signal = computeSignal({
      presence: [{ userId: 'u1', localDate: today }],
      memberCount: 2,
      today,
      circleStartDate: today,
    });

    expect(signal.dayNumber).toBe(1);
    expect(signal.dates).toEqual([today]);
    expect(signal.dailyRates).toEqual([0.5]);
    expect(signal.rate).toBeCloseTo(0.5);
    expect(signal.state).toBe('warm');
  });

  test('mid-window (day 4) — window has grown to 4 days, not yet capped at 7', () => {
    const today = '2026-07-10';
    // circle started 3 days before today -> dayNumber 4, windowSize 4
    const circleStartDate = '2026-07-07';
    const dates = ['2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    const presence = [
      { userId: 'u1', localDate: dates[0] },
      { userId: 'u2', localDate: dates[0] },
      { userId: 'u1', localDate: dates[2] },
      { userId: 'u1', localDate: dates[3] },
      { userId: 'u2', localDate: dates[3] },
    ];

    const signal = computeSignal({ presence, memberCount: 2, today, circleStartDate });

    expect(signal.dayNumber).toBe(4);
    expect(signal.dates).toEqual(dates);
    // daily counts: [2, 0, 1, 2] out of 2 members -> rates [1, 0, 0.5, 1]
    expect(signal.dailyRates).toEqual([1, 0, 0.5, 1]);
    // (2+0+1+2)/(2*4) = 0.625 -> "warm" (0.3-0.7 band)
    expect(signal.rate).toBeCloseTo(0.625);
    expect(signal.state).toBe('warm');
  });

  test('day 21 — window caps at 7 days even though the circle is much older', () => {
    const today = '2026-07-21';
    const circleStartDate = '2026-07-01'; // 20 days before today -> dayNumber 21
    const last7Dates = getTrailingLocalDates(today, 7);
    const presence = last7Dates.flatMap((date) => [
      { userId: 'u1', localDate: date },
      { userId: 'u2', localDate: date },
      { userId: 'u3', localDate: date },
    ]);

    const signal = computeSignal({ presence, memberCount: 3, today, circleStartDate });

    expect(signal.dayNumber).toBe(21);
    expect(signal.dates).toHaveLength(7);
    expect(signal.dates).toEqual(last7Dates);
    expect(signal.rate).toBeCloseTo(1);
    expect(signal.state).toBe('glowing');
  });

  test('DST-boundary dates — day number is exact across a real US spring-forward transition', () => {
    // 2026 US DST begins Sunday 2026-03-08 (clocks spring forward). A
    // pre-UTC-fix version of daysBetween (local-time Date subtraction)
    // was vulnerable to exactly this kind of boundary skewing the
    // calendar-day count by the DST offset.
    const circleStartDate = '2026-03-07';
    const today = '2026-03-09';

    const signal = computeSignal({
      presence: [],
      memberCount: 1,
      today,
      circleStartDate,
    });

    expect(signal.dayNumber).toBe(3);
    expect(signal.dates).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
  });

  test('DST-boundary dates — exact across a real US fall-back transition', () => {
    // 2026 US DST ends Sunday 2026-11-01 (clocks fall back).
    const circleStartDate = '2026-10-31';
    const today = '2026-11-02';

    const signal = computeSignal({
      presence: [],
      memberCount: 1,
      today,
      circleStartDate,
    });

    expect(signal.dayNumber).toBe(3);
    expect(signal.dates).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });

  test('empty circle — zero members never divides by zero, always rests', () => {
    const today = '2026-07-05';
    const signal = computeSignal({
      presence: [],
      memberCount: 0,
      today,
      circleStartDate: today,
    });

    expect(signal.rate).toBe(0);
    expect(signal.state).toBe('resting');
    expect(signal.dailyRates).toEqual([0]);
  });

  test('solo circle — a single stale check-in floors the state at warm, never fully glowing at a low rate', () => {
    const today = '2026-07-05';
    const circleStartDate = '2026-07-01'; // dayNumber 5, windowSize 5
    const signal = computeSignal({
      presence: [{ userId: 'solo-user', localDate: today }],
      memberCount: 1,
      today,
      circleStartDate,
    });

    expect(signal.dayNumber).toBe(5);
    // 1 check-in out of 5 days for 1 member -> rate 0.2, which alone
    // would be "resting", but a same-day check-in floors it to "warm".
    expect(signal.rate).toBeCloseTo(0.2);
    expect(signal.state).toBe('warm');
  });
});
