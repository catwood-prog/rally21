/**
 * AL1 job 2 — the native half: what actually reaches expo-notifications.
 *
 * Runs under jest-expo's default Platform.OS ('ios'), no override needed —
 * the web branch's own coverage (lib/alarmReminder.web.test.ts) mocks
 * Platform.OS instead, so the two files never fight over one module mock
 * (the wakeLock pair is the precedent for that split).
 *
 * The three things proven here are the three the VERIFY block asks about
 * and the three that cannot be reasoned from source: a check-in cancels
 * TODAY'S and nothing else, toggling off really cancels the pending
 * notifications rather than merely writing a preference, and app start
 * never cold-prompts for permission.
 */
jest.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { HIGH: 4 },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { STRINGS } from '@/constants/strings';

import {
  cancelTodaysReminder,
  REMINDER_DATA_TYPE,
  REMINDER_WINDOW_DAYS,
  syncDailyReminder,
} from './alarmReminder';

const mocked = Notifications as unknown as {
  getAllScheduledNotificationsAsync: jest.Mock;
  scheduleNotificationAsync: jest.Mock;
  cancelScheduledNotificationAsync: jest.Mock;
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
};

function ourScheduled(localDate: string, identifier = `ours-${localDate}`) {
  return { identifier, content: { data: { type: REMINDER_DATA_TYPE, localDate } } };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mocked.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  mocked.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mocked.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
});

describe('syncDailyReminder', () => {
  it('arms the whole window with sound, one notification per day', async () => {
    const result = await syncDailyReminder({
      enabled: true,
      alarmTime: '21:00:00',
      now: new Date(2026, 6, 15, 10, 0, 0, 0),
    });

    expect(result).toBe('scheduled');
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledTimes(REMINDER_WINDOW_DAYS);

    const first = mocked.scheduleNotificationAsync.mock.calls[0][0];
    expect(first.content.sound).toBe('default');
    expect(first.content.data).toEqual({ type: REMINDER_DATA_TYPE, localDate: '2026-07-15' });
    expect(first.trigger.date.getHours()).toBe(21);

    // Every armed day is distinct — the multi-circle guarantee, at the
    // layer that actually talks to the OS.
    const dates = mocked.scheduleNotificationAsync.mock.calls.map((c) => c[0].content.data.localDate);
    expect(new Set(dates).size).toBe(REMINDER_WINDOW_DAYS);
  });

  it('never says "alarm" to the person', async () => {
    await syncDailyReminder({ enabled: true, alarmTime: '08:00:00', now: new Date(2026, 6, 15, 6, 0) });
    const { content } = mocked.scheduleNotificationAsync.mock.calls[0][0];
    expect(`${content.title} ${content.body}`.toLowerCase()).not.toContain('alarm');
  });

  it('TOGGLING OFF cancels the pending notifications, it does not just stop scheduling', async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([
      ourScheduled('2026-07-15'),
      ourScheduled('2026-07-16'),
    ]);

    const result = await syncDailyReminder({ enabled: false, alarmTime: null });

    expect(result).toBe('off');
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('ours-2026-07-15');
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('ours-2026-07-16');
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels only its OWN notifications, never anything else scheduled locally', async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([
      ourScheduled('2026-07-15'),
      { identifier: 'someone-elses', content: { data: { type: 'something_else' } } },
      { identifier: 'no-data-at-all', content: {} },
    ]);

    await syncDailyReminder({ enabled: false, alarmTime: null });

    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('ours-2026-07-15');
  });

  it('re-arming is a full replace, so a changed time can never leave the old one behind', async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([ourScheduled('2026-07-15', 'stale')]);

    await syncDailyReminder({
      enabled: true,
      alarmTime: '19:00:00',
      now: new Date(2026, 6, 15, 10, 0),
    });

    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('stale');
    expect(mocked.scheduleNotificationAsync.mock.calls[0][0].trigger.date.getHours()).toBe(19);
  });

  it('NEVER COLD-PROMPTS: the app-start call only reads the permission', async () => {
    await syncDailyReminder({
      enabled: true,
      alarmTime: '21:00:00',
      now: new Date(2026, 6, 15, 10, 0),
    });

    expect(mocked.getPermissionsAsync).toHaveBeenCalled();
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks the OS only on the explicit turn-it-on tap', async () => {
    await syncDailyReminder({
      enabled: true,
      alarmTime: '21:00:00',
      requestPermission: true,
      now: new Date(2026, 6, 15, 10, 0),
    });

    expect(mocked.requestPermissionsAsync).toHaveBeenCalled();
  });

  it('schedules nothing on a phone that refuses notifications, and says so', async () => {
    mocked.getPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const result = await syncDailyReminder({
      enabled: true,
      alarmTime: '21:00:00',
      now: new Date(2026, 6, 15, 10, 0),
    });

    expect(result).toBe('permission-denied');
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("a top-up after a check-in does not re-arm the day the check-in just cancelled", async () => {
    const now = new Date(2026, 6, 15, 10, 0);
    await cancelTodaysReminder(now);
    jest.clearAllMocks();
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    mocked.getPermissionsAsync.mockResolvedValue({ status: 'granted' });

    await syncDailyReminder({ enabled: true, alarmTime: '21:00:00', now });

    const dates = mocked.scheduleNotificationAsync.mock.calls.map((c) => c[0].content.data.localDate);
    expect(dates).not.toContain('2026-07-15');
    expect(dates[0]).toBe('2026-07-16');
  });
});

describe('cancelTodaysReminder', () => {
  it("cancels TODAY'S reminder and leaves every later day armed", async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([
      ourScheduled('2026-07-15'),
      ourScheduled('2026-07-16'),
      ourScheduled('2026-07-17'),
    ]);

    await cancelTodaysReminder(new Date(2026, 6, 15, 7, 30));

    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('ours-2026-07-15');
  });

  it('leaves other kinds of scheduled notification alone', async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'someone-elses', content: { data: { type: 'other', localDate: '2026-07-15' } } },
    ]);

    await cancelTodaysReminder(new Date(2026, 6, 15, 7, 30));

    expect(mocked.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('AL1 PHASE 2 (B10 job 2) — the time-sensitive entitlement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    mocked.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  });

  it('every scheduled slot asks for interruptionLevel timeSensitive', async () => {
    await syncDailyReminder({ enabled: true, alarmTime: '07:30:00', now: new Date(2026, 6, 15, 6, 0) });

    expect(mocked.scheduleNotificationAsync).toHaveBeenCalled();
    // EVERY slot, not just the first: a window is armed in a loop, and a
    // level set on only the first would break through Focus on day one and
    // silently stop for the other twenty-nine.
    for (const call of mocked.scheduleNotificationAsync.mock.calls) {
      expect(call[0].content.interruptionLevel).toBe('timeSensitive');
    }
  });

  it('the entitlement is DECLARED, not just requested', () => {
    // The key on the notification does nothing on its own — iOS drops it
    // unless the binary carries the matching entitlement. The two halves
    // are one change, so the test that proves one proves the other or it
    // proves nothing.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appJson = require('../app.json');
    expect(appJson.expo.ios.entitlements['com.apple.developer.usernotifications.time-sensitive']).toBe(
      true
    );
  });

  it('phase 2 does NOT make it an alarm, and the copy still never says so', () => {
    // The entitlement breaks Focus, never the silent switch. The copy law
    // therefore survives phase 2 unchanged — this is the guard that stops a
    // future session "upgrading" the wording along with the capability.
    const copy = [
      STRINGS.alarmReminderTitle,
      STRINGS.alarmReminderBody,
      STRINGS.alarmToggleLabel,
      STRINGS.alarmToggleHelperOff,
      STRINGS.alarmReminderChannelName,
    ].join(' ');
    expect(copy.toLowerCase()).not.toContain('alarm');
  });
});
