/**
 * AL1 job 2 — the schedule/cancel/reschedule logic, pinned.
 *
 * The whole point of the module's split is that everything that DECIDES
 * anything is pure: buildReminderPlan takes a preference and a moment and
 * returns instants, and the expo-notifications half only does what it is
 * told. The notification module is mocked here purely so the import
 * resolves (it wraps a native module Jest has no registration for, same
 * class of issue as expo-audio in jest.setup.js) — nothing in this file
 * touches it.
 */
jest.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { HIGH: 4 },
}));

import {
  buildReminderPlan,
  formatTimeForDisplay,
  formatTimeOfDay,
  parseTimeOfDay,
  prefillAlarmTime,
  PREFILL_FALLBACK_TIME,
  REMINDER_WINDOW_DAYS,
} from './alarmReminder';

describe('parseTimeOfDay', () => {
  it('accepts both the HH:MM and the Postgres HH:MM:SS shapes', () => {
    expect(parseTimeOfDay('08:00')).toEqual({ hour: 8, minute: 0 });
    expect(parseTimeOfDay('08:00:00')).toEqual({ hour: 8, minute: 0 });
    expect(parseTimeOfDay('21:45:00')).toEqual({ hour: 21, minute: 45 });
    expect(parseTimeOfDay('00:00:00')).toEqual({ hour: 0, minute: 0 });
  });

  it('refuses anything that is not a real time of day, rather than guessing', () => {
    expect(parseTimeOfDay(null)).toBeNull();
    expect(parseTimeOfDay('')).toBeNull();
    expect(parseTimeOfDay('24:00:00')).toBeNull();
    expect(parseTimeOfDay('08:60:00')).toBeNull();
    expect(parseTimeOfDay('8:00')).toBeNull();
    expect(parseTimeOfDay('breakfast')).toBeNull();
  });
});

describe('formatTimeOfDay / formatTimeForDisplay', () => {
  it('round-trips the stored shape', () => {
    expect(formatTimeOfDay(8, 0)).toBe('08:00:00');
    expect(formatTimeOfDay(21, 45)).toBe('21:45:00');
  });

  it('writes times to people in 12-hour form, midnight and noon included', () => {
    expect(formatTimeForDisplay('08:00:00')).toBe('8:00am');
    expect(formatTimeForDisplay('21:30:00')).toBe('9:30pm');
    expect(formatTimeForDisplay('00:15:00')).toBe('12:15am');
    expect(formatTimeForDisplay('12:00:00')).toBe('12:00pm');
  });

  it('returns null rather than half a sentence for an unreadable time', () => {
    expect(formatTimeForDisplay(null)).toBeNull();
    expect(formatTimeForDisplay('nope')).toBeNull();
  });
});

describe('prefillAlarmTime — the prefill rule', () => {
  it('prefills when every circle agrees', () => {
    expect(prefillAlarmTime(['08:00:00', '08:00:00', '08:00:00'])).toBe('08:00:00');
    expect(prefillAlarmTime(['21:00:00'])).toBe('21:00:00');
  });

  it('does NOT guess when the circles disagree', () => {
    // The live cohort's own shape on 30 July: three-circle members sitting
    // in both an 08:00 and a 21:00 circle. Four of the six accounts land
    // on this branch, so it is the common case, not the edge one.
    expect(prefillAlarmTime(['08:00:00', '08:00:00', '21:00:00'])).toBeNull();
    expect(prefillAlarmTime(['08:00:00', '21:00:00'])).toBeNull();
  });

  it('does NOT guess when there are no circles at all', () => {
    // Which is exactly the onboarding case: the reminders ask runs BEFORE
    // circle-setup, so a brand-new account always lands here.
    expect(prefillAlarmTime([])).toBeNull();
  });

  it('treats a circle with no declared time as disagreement, never as a vote', () => {
    expect(prefillAlarmTime(['08:00:00', null])).toBeNull();
    expect(prefillAlarmTime([null])).toBeNull();
  });

  it('normalises the agreed value to the stored shape', () => {
    expect(prefillAlarmTime(['08:00', '08:00'])).toBe('08:00:00');
  });
});

describe('buildReminderPlan', () => {
  // A Wednesday, mid-morning, so "today's 08:00 has passed" and "today's
  // 21:00 has not" are both expressible from the same instant.
  const now = new Date(2026, 6, 15, 10, 30, 0, 0);

  it('schedules nothing at all when the reminder is off', () => {
    expect(buildReminderPlan({ enabled: false, alarmTime: '08:00:00', now })).toEqual([]);
  });

  it('schedules nothing when there is no time — the pair is never half-set', () => {
    expect(buildReminderPlan({ enabled: true, alarmTime: null, now })).toEqual([]);
    expect(buildReminderPlan({ enabled: true, alarmTime: 'garbage', now })).toEqual([]);
  });

  it('arms exactly ONE reminder per calendar day across the window', () => {
    const plan = buildReminderPlan({ enabled: true, alarmTime: '21:00:00', now });
    expect(plan).toHaveLength(REMINDER_WINDOW_DAYS);
    expect(new Set(plan.map((s) => s.localDate)).size).toBe(REMINDER_WINDOW_DAYS);
    expect(plan[0].localDate).toBe('2026-07-15');
    expect(plan[1].localDate).toBe('2026-07-16');
  });

  it('MULTI-CIRCLE: the plan takes no circle input, so three circles cannot become three reminders', () => {
    // This is the structural half of AL1's multi-circle proof. There is no
    // circle parameter to pass, no membership loop to get wrong and no
    // coalescing pass to need — the user-level shape is what makes the
    // per-circle failure unrepresentable rather than merely avoided.
    const plan = buildReminderPlan({ enabled: true, alarmTime: '08:00:00', now, windowDays: 3 });
    const perDay = plan.reduce<Record<string, number>>((acc, slot) => {
      acc[slot.localDate] = (acc[slot.localDate] ?? 0) + 1;
      return acc;
    }, {});
    expect(Object.values(perDay).every((count) => count === 1)).toBe(true);
  });

  it('fires at the chosen wall-clock time, not at an offset from now', () => {
    const [first] = buildReminderPlan({ enabled: true, alarmTime: '21:15:00', now, windowDays: 1 });
    expect(first.fireAt.getHours()).toBe(21);
    expect(first.fireAt.getMinutes()).toBe(15);
    expect(first.fireAt.getFullYear()).toBe(2026);
  });

  it("drops today's slot when the chosen time has already passed", () => {
    const plan = buildReminderPlan({ enabled: true, alarmTime: '08:00:00', now, windowDays: 3 });
    expect(plan.map((s) => s.localDate)).toEqual(['2026-07-16', '2026-07-17']);
  });

  it("drops today's slot when a check-in has already cancelled it, and keeps every later day", () => {
    const plan = buildReminderPlan({
      enabled: true,
      alarmTime: '21:00:00',
      now,
      skipToday: true,
      windowDays: 3,
    });
    expect(plan.map((s) => s.localDate)).toEqual(['2026-07-16', '2026-07-17']);
  });

  it('every armed instant is in the future — the OS is never handed a past date', () => {
    const plan = buildReminderPlan({ enabled: true, alarmTime: '21:00:00', now });
    expect(plan.every((s) => s.fireAt.getTime() > now.getTime())).toBe(true);
  });

  it('keeps the chosen hour across a month boundary', () => {
    const endOfMonth = new Date(2026, 6, 30, 6, 0, 0, 0);
    const plan = buildReminderPlan({
      enabled: true,
      alarmTime: '07:30:00',
      now: endOfMonth,
      windowDays: 4,
    });
    expect(plan.map((s) => s.localDate)).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
    expect(plan.every((s) => s.fireAt.getHours() === 7 && s.fireAt.getMinutes() === 30)).toBe(true);
  });

  it('opens at 08:00 where the prefill rule declines to guess', () => {
    expect(parseTimeOfDay(PREFILL_FALLBACK_TIME)).toEqual({ hour: 8, minute: 0 });
  });
});
