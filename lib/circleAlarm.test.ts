/**
 * AK1 — THE PURE PLANNER, and above all THE TRAP.
 *
 * buildCircleAlarmPlan is deliberately free of the native module, the
 * network and the clock, so the property the whole feature rests on can be
 * tested without a device: that suppression is NEVER CUMULATIVE.
 */

import {
  ALL_WEEKDAYS,
  buildCircleAlarmPlan,
  parseAlarmTime,
  type CircleAlarmMembership,
} from './circleAlarm';

const membership = (over: Partial<CircleAlarmMembership> = {}): CircleAlarmMembership => ({
  membershipId: 'm-1',
  circleId: 'c-1',
  circleName: 'Morning pages',
  alarmEnabled: true,
  alarmTime: '07:30:00',
  finishedAt: null,
  circleIsActive: true,
  circleCompletedAt: null,
  ...over,
});

/** A Wednesday. getDay() === 3. */
const WED = new Date(2026, 7, 26, 9, 0, 0);

describe('AK1 — the plan a device should be holding', () => {
  test('an enabled membership arms all seven days when nothing has been checked in', () => {
    const plan = buildCircleAlarmPlan({
      memberships: [membership()],
      checkedInCircleIdsToday: [],
      now: WED,
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].weekdays).toEqual(ALL_WEEKDAYS);
    expect(plan[0].hour).toBe(7);
    expect(plan[0].minute).toBe(30);
  });

  test('THE ALARM ID IS THE MEMBERSHIP ID — which is what makes reconciliation possible', () => {
    const plan = buildCircleAlarmPlan({
      memberships: [membership({ membershipId: 'the-membership' })],
      checkedInCircleIdsToday: [],
      now: WED,
    });
    expect(plan[0].alarmId).toBe('the-membership');
  });

  test("a circle already checked into today loses TODAY'S weekday and only today's", () => {
    const plan = buildCircleAlarmPlan({
      memberships: [membership()],
      checkedInCircleIdsToday: ['c-1'],
      now: WED,
    });
    expect(WED.getDay()).toBe(3);
    expect(plan[0].weekdays).toEqual([0, 1, 2, 4, 5, 6]);
    expect(plan[0].weekdays).toHaveLength(6);
  });

  test('a check-in in ANOTHER circle does not quiet this one', () => {
    const plan = buildCircleAlarmPlan({
      memberships: [membership({ circleId: 'c-1' })],
      checkedInCircleIdsToday: ['c-OTHER'],
      now: WED,
    });
    expect(plan[0].weekdays).toEqual(ALL_WEEKDAYS);
  });

  // ───────────────────────────────────────────────────────────────────
  // THE SINGLE MOST IMPORTANT TEST IN THE SECTION.
  // ───────────────────────────────────────────────────────────────────
  test('THE TRAP: seven days of PERFECT adherence never empties the weekday set', () => {
    // Someone checks in every single day for a week. If suppression were
    // ever cumulative — if each day's check-in removed a weekday that the
    // next recompute did not put back — the most consistent person in the
    // app would end the week with an alarm that never rings again, in
    // silence. That is the warmth laws inverted, and it is exactly what
    // this asserts cannot happen.
    const seen: number[][] = [];
    for (let offset = 0; offset < 7; offset++) {
      const day = new Date(2026, 7, 26 + offset, 9, 0, 0);
      // Each day is recomputed FROM SCRATCH from that day's check-in only,
      // which is precisely how syncCircleAlarms calls it.
      const plan = buildCircleAlarmPlan({
        memberships: [membership()],
        checkedInCircleIdsToday: ['c-1'],
        now: day,
      });
      expect(plan).toHaveLength(1);
      expect(plan[0].weekdays.length).toBe(6);
      expect(plan[0].weekdays).not.toContain(day.getDay());
      seen.push(plan[0].weekdays);
    }
    // Every weekday is still armed on some day of the week — nothing has
    // been permanently lost.
    const everArmed = new Set(seen.flat());
    expect([...everArmed].sort()).toEqual(ALL_WEEKDAYS);
  });

  test('and the day after a checked-in day is armed again', () => {
    const wedPlan = buildCircleAlarmPlan({
      memberships: [membership()],
      checkedInCircleIdsToday: ['c-1'],
      now: WED,
    });
    const thu = new Date(2026, 7, 27, 9, 0, 0);
    const thuPlan = buildCircleAlarmPlan({
      memberships: [membership()],
      checkedInCircleIdsToday: [],
      now: thu,
    });
    expect(wedPlan[0].weekdays).not.toContain(3);
    expect(thuPlan[0].weekdays).toContain(3); // Wednesday is back
  });

  describe('every state that must hold NO alarm', () => {
    test('the toggle is off', () => {
      expect(
        buildCircleAlarmPlan({
          memberships: [membership({ alarmEnabled: false, alarmTime: null })],
          checkedInCircleIdsToday: [],
          now: WED,
        })
      ).toEqual([]);
    });

    test('the member finished their rally (PA2 finished_at)', () => {
      expect(
        buildCircleAlarmPlan({
          memberships: [membership({ finishedAt: '2026-08-20T00:00:00Z' })],
          checkedInCircleIdsToday: [],
          now: WED,
        })
      ).toEqual([]);
    });

    test('the circle is no longer active', () => {
      expect(
        buildCircleAlarmPlan({
          memberships: [membership({ circleIsActive: false })],
          checkedInCircleIdsToday: [],
          now: WED,
        })
      ).toEqual([]);
    });

    test('the circle has completed', () => {
      expect(
        buildCircleAlarmPlan({
          memberships: [membership({ circleCompletedAt: '2026-08-20T00:00:00Z' })],
          checkedInCircleIdsToday: [],
          now: WED,
        })
      ).toEqual([]);
    });

    test('a corrupt time is DROPPED rather than guessed at', () => {
      // The check constraint makes enabled-with-no-time unrepresentable,
      // so this is a corrupt read, not a real state. Guessing a time would
      // ring at somebody at an hour they never chose.
      expect(
        buildCircleAlarmPlan({
          memberships: [membership({ alarmTime: 'not-a-time' })],
          checkedInCircleIdsToday: [],
          now: WED,
        })
      ).toEqual([]);
    });

    test('a membership that has left is simply absent from the plan', () => {
      // leave_circle hard-deletes the row, so the planner never sees it —
      // and syncCircleAlarms cancels any system alarm not in the plan.
      expect(
        buildCircleAlarmPlan({ memberships: [], checkedInCircleIdsToday: [], now: WED })
      ).toEqual([]);
    });
  });

  test('several circles each get their own alarm, at their own time', () => {
    const plan = buildCircleAlarmPlan({
      memberships: [
        membership({ membershipId: 'm-1', circleId: 'c-1', alarmTime: '07:00:00' }),
        membership({ membershipId: 'm-2', circleId: 'c-2', alarmTime: '21:15:00' }),
        membership({ membershipId: 'm-3', circleId: 'c-3', alarmEnabled: false, alarmTime: null }),
      ],
      checkedInCircleIdsToday: ['c-2'],
      now: WED,
    });
    // ONE recurring alarm per circle — 3 circles that want one give 2 here
    // because the third is off. The 90-alarm trap is designed out: this
    // count can never exceed the person's circle count.
    expect(plan.map((s) => s.alarmId)).toEqual(['m-1', 'm-2']);
    expect(plan[0].weekdays).toHaveLength(7);
    expect(plan[1].weekdays).toHaveLength(6); // c-2 checked in today
    expect(plan[1].hour).toBe(21);
  });

  test('the title names the circle, because three alarms need telling apart', () => {
    const plan = buildCircleAlarmPlan({
      memberships: [membership({ circleName: 'Evening run' })],
      checkedInCircleIdsToday: [],
      now: WED,
    });
    expect(plan[0].title).toContain('Evening run');
  });
});

describe('parseAlarmTime', () => {
  test('reads both HH:MM and HH:MM:SS', () => {
    expect(parseAlarmTime('07:30:00')).toEqual({ hour: 7, minute: 30 });
    expect(parseAlarmTime('07:30')).toEqual({ hour: 7, minute: 30 });
  });

  test('refuses nonsense rather than coercing it', () => {
    expect(parseAlarmTime(null)).toBeNull();
    expect(parseAlarmTime('')).toBeNull();
    expect(parseAlarmTime('25:00:00')).toBeNull();
    expect(parseAlarmTime('07:99:00')).toBeNull();
    expect(parseAlarmTime('nope')).toBeNull();
  });
});

describe('the weekday numbering is JS getDay(), not ISO', () => {
  // The native module maps 0->.sunday … 6->.saturday. If this convention
  // ever drifts, every alarm fires on the wrong day — a silent, total
  // failure that no type would catch.
  test('0 is Sunday and 6 is Saturday', () => {
    const sunday = new Date(2026, 7, 23, 9, 0, 0);
    const saturday = new Date(2026, 7, 29, 9, 0, 0);
    expect(sunday.getDay()).toBe(0);
    expect(saturday.getDay()).toBe(6);

    const sundayPlan = buildCircleAlarmPlan({
      memberships: [membership()],
      checkedInCircleIdsToday: ['c-1'],
      now: sunday,
    });
    expect(sundayPlan[0].weekdays).toEqual([1, 2, 3, 4, 5, 6]);

    const saturdayPlan = buildCircleAlarmPlan({
      memberships: [membership()],
      checkedInCircleIdsToday: ['c-1'],
      now: saturday,
    });
    expect(saturdayPlan[0].weekdays).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
