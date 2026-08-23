/**
 * AK1 job 3 — THE PLATFORM FENCE ON ANDROID, proven at the MODULE
 * boundary rather than by a bundle grep.
 *
 * The native module is deliberately mocked as PRESENT AND WORKING here.
 * That is the whole point: if the fence only held because Jest cannot find
 * a native module, it would prove nothing about a real android build. With
 * a fully functional fake underneath it, the ONLY thing that can keep the
 * feature off android is the Platform gate — so that is what this pins.
 *
 * (Platform.OS is mocked because jest-expo's default is 'ios'. Same split
 * AL1 uses across alarmReminder.web/native.test.ts.)
 */
jest.mock('react-native', () => ({
  Platform: { OS: 'android', select: (spec: Record<string, unknown>) => spec.android ?? spec.default },
}));

// THE MOCK IS BUILT INSIDE THE FACTORY, deliberately. A `const mockNative`
// declared above jest.mock() is still in its temporal dead zone when the
// hoisted `import` first loads the module under test, so
// requireOptionalNativeModule would hand back `undefined` and the module's
// `native` would be null forever after — which makes every fence assertion
// pass for the WRONG REASON (nothing to gate, so nothing happens). Building
// it in the factory and reading it back out is what makes these tests real.
jest.mock('expo', () => {
  const mod = {
    isAvailable: jest.fn(() => true),
    getAuthorizationState: jest.fn().mockResolvedValue('authorized'),
    requestAuthorization: jest.fn().mockResolvedValue('authorized'),
    scheduleWeeklyAlarm: jest.fn().mockResolvedValue(undefined),
    cancelAlarm: jest.fn().mockResolvedValue(undefined),
    listAlarmIds: jest.fn().mockResolvedValue([]),
  };
  return { requireOptionalNativeModule: () => mod, __rallyAlarmMock: mod };
});



import * as expoModule from 'expo';
import { isAlarmKitAvailable } from '@/modules/rally-alarm-kit';

import { setCircleAlarm, syncCircleAlarms } from './circleAlarm';

const mockNative = (expoModule as unknown as {
  __rallyAlarmMock: Record<string, jest.Mock>;
}).__rallyAlarmMock;

describe('AK1 on android — the feature does not exist rather than existing-but-broken', () => {
  beforeEach(() => jest.clearAllMocks());

  test('isAlarmKitAvailable is false even though the native module reports available', () => {
    expect(mockNative.isAvailable()).toBe(true);
    expect(isAlarmKitAvailable()).toBe(false);
  });

  test('syncCircleAlarms reports unsupported and touches nothing', async () => {
    await expect(syncCircleAlarms({ userId: 'u-1' })).resolves.toBe('unsupported');
    expect(mockNative.listAlarmIds).not.toHaveBeenCalled();
    expect(mockNative.scheduleWeeklyAlarm).not.toHaveBeenCalled();
    expect(mockNative.cancelAlarm).not.toHaveBeenCalled();
  });

  test('setCircleAlarm refuses without ever asking for permission', async () => {
    await expect(
      setCircleAlarm({
        membershipId: 'm-1',
        circleId: 'c-1',
        circleName: 'Morning pages',
        enabled: true,
        time: '07:30:00',
      })
    ).resolves.toEqual({ status: 'unsupported' });
    // PN1's law reaches even here: no prompt on a platform that has no
    // alarms to grant.
    expect(mockNative.requestAuthorization).not.toHaveBeenCalled();
    expect(mockNative.scheduleWeeklyAlarm).not.toHaveBeenCalled();
  });
});
