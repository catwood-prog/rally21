/**
 * AL1 job 4 — WEB HAS NO REMINDER AT ALL, proven at the module boundary.
 *
 * Hiding the control (the Platform.OS gates in settings.tsx and
 * RemindersAskCard.tsx) is the visible half; this is the other half. A
 * stored preference from the person's phone must not cause the web app to
 * try to schedule anything: local scheduled notifications are native-only,
 * so on web the feature does not exist rather than existing-but-broken.
 *
 * Platform.OS is mocked to 'web' here because jest-expo's own default is
 * 'ios' (the native branch's coverage lives in alarmReminder.native.test.ts,
 * which relies on that default). The lib/wakeLock test pair is the
 * precedent for splitting the two branches across two files rather than
 * fighting over one module mock.
 */
jest.mock('react-native', () => ({
  Platform: { OS: 'web', select: (spec: Record<string, unknown>) => spec.web ?? spec.default },
}));
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

import * as Notifications from 'expo-notifications';

import { cancelTodaysReminder, syncDailyReminder } from './alarmReminder';

const mocked = Notifications as unknown as {
  scheduleNotificationAsync: jest.Mock;
  cancelScheduledNotificationAsync: jest.Mock;
  getAllScheduledNotificationsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  getPermissionsAsync: jest.Mock;
};

beforeEach(() => jest.clearAllMocks());

describe('the reminder on web', () => {
  it('reports itself unsupported and touches nothing, even for an enabled account', async () => {
    const result = await syncDailyReminder({ enabled: true, alarmTime: '08:00:00' });

    expect(result).toBe('unsupported');
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mocked.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(mocked.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('never asks the browser for permission, even on an explicit turn-it-on', async () => {
    await syncDailyReminder({ enabled: true, alarmTime: '08:00:00', requestPermission: true });
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('a web check-in cancels nothing, because nothing was ever scheduled', async () => {
    await cancelTodaysReminder();
    expect(mocked.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(mocked.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});
