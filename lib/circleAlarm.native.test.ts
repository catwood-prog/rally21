/**
 * AK1 on native iOS — the three claims that cannot be read off the planner:
 * the PRE-26 half of the fence, JOB 7's refusal law, and JOB 4's earned
 * moment.
 *
 * jest-expo's default Platform.OS is 'ios', so this file deliberately does
 * NOT mock react-native — the web/android halves live in their own files
 * (AL1's split, and the reason is that a Platform mock is file-wide).
 */

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
import { isAlarmKitAvailable, MAX_ALARMS_ERROR } from '@/modules/rally-alarm-kit';

import { setCircleAlarm, syncCircleAlarms } from './circleAlarm';
import { captureError } from './sentry';
import { supabase } from './supabase';

const mockNative = (expoModule as unknown as {
  __rallyAlarmMock: Record<string, jest.Mock>;
}).__rallyAlarmMock;

/** A supabase query builder stub whose every `.eq()` is both chainable and
 * awaitable, which is the shape both reads in circleAlarm.ts use. */
function result(data: unknown) {
  const thenable: any = {
    eq: () => thenable,
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res),
  };
  return thenable;
}

const MEMBERSHIP_ROW = {
  id: 'm-1',
  circle_id: 'c-1',
  alarm_enabled: true,
  alarm_time: '07:30:00',
  finished_at: null,
  circles: { name: 'Morning pages', is_active: true, completed_at: null },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.isAvailable.mockReturnValue(true);
  mockNative.getAuthorizationState.mockResolvedValue('authorized');
  mockNative.requestAuthorization.mockResolvedValue('authorized');
  mockNative.scheduleWeeklyAlarm.mockResolvedValue(undefined);
  mockNative.listAlarmIds.mockResolvedValue([]);
  (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
  (supabase.from as jest.Mock).mockImplementation((table: string) => ({
    select: () => result(table === 'memberships' ? [MEMBERSHIP_ROW] : []),
  }));
  (supabase.auth as any).getUser = jest.fn().mockResolvedValue({
    data: { user: { id: 'u-1' } },
  });
});

describe('the fence on an iPhone BELOW iOS 26 — the module is linked, AlarmKit is not there', () => {
  test('isAlarmKitAvailable is false, and nothing is scheduled', async () => {
    mockNative.isAvailable.mockReturnValue(false);
    expect(isAlarmKitAvailable()).toBe(false);
    await expect(syncCircleAlarms({ userId: 'u-1' })).resolves.toBe('unsupported');
    expect(mockNative.scheduleWeeklyAlarm).not.toHaveBeenCalled();
    expect(mockNative.requestAuthorization).not.toHaveBeenCalled();
  });

  test('the toggle refuses rather than writing a preference nothing can honour', async () => {
    mockNative.isAvailable.mockReturnValue(false);
    await expect(
      setCircleAlarm({
        membershipId: 'm-1',
        circleId: 'c-1',
        circleName: 'Morning pages',
        enabled: true,
        time: '07:30:00',
      })
    ).resolves.toEqual({ status: 'unsupported' });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('JOB 7 — the on-state is driven by THE SCHEDULE, never by the write', () => {
  test('a maximumLimitReached refusal leaves the toggle off and writes NOTHING', async () => {
    const refusal = Object.assign(new Error('maximumLimitReached'), {
      code: MAX_ALARMS_ERROR,
    });
    mockNative.scheduleWeeklyAlarm.mockRejectedValueOnce(refusal);

    const res = await setCircleAlarm({
      membershipId: 'm-8',
      circleId: 'c-8',
      circleName: 'Eighth circle',
      enabled: true,
      time: '07:30:00',
    });

    // The person is told the truth, the toggle stays off...
    expect(res).toEqual({ status: 'refused-limit' });
    // ...and crucially the DB is NOT written, so nothing anywhere claims
    // an alarm exists. This is PN2's granted-but-unregistered trap held
    // shut: a swallowed refusal here would leave someone believing an
    // alarm is set that can never ring.
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('the refusal is reported through captureError WITH the circle id', async () => {
    mockNative.scheduleWeeklyAlarm.mockRejectedValueOnce(
      Object.assign(new Error('maximumLimitReached'), { code: MAX_ALARMS_ERROR })
    );
    await setCircleAlarm({
      membershipId: 'm-8',
      circleId: 'c-8',
      circleName: 'Eighth circle',
      enabled: true,
      time: '07:30:00',
    });
    expect(captureError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ circleId: 'c-8' })
    );
  });

  test('on success the schedule happens BEFORE the write, and the write follows', async () => {
    const order: string[] = [];
    mockNative.scheduleWeeklyAlarm.mockImplementationOnce(async () => {
      order.push('schedule');
    });
    (supabase.rpc as jest.Mock).mockImplementationOnce(async () => {
      order.push('write');
      return { error: null };
    });

    const res = await setCircleAlarm({
      membershipId: 'm-1',
      circleId: 'c-1',
      circleName: 'Morning pages',
      enabled: true,
      time: '07:30:00',
    });

    expect(res).toEqual({ status: 'on' });
    expect(order).toEqual(['schedule', 'write']);
    expect(supabase.rpc).toHaveBeenCalledWith('set_circle_alarm', {
      p_circle_id: 'c-1',
      p_enabled: true,
      p_time: '07:30:00',
    });
  });

  test('if the WRITE fails after a good schedule, the alarm is cancelled again', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({ error: new Error('offline') });
    await expect(
      setCircleAlarm({
        membershipId: 'm-1',
        circleId: 'c-1',
        circleName: 'Morning pages',
        enabled: true,
        time: '07:30:00',
      })
    ).rejects.toThrow();
    // An alarm ringing for a preference the server does not hold is worse
    // than no alarm: the next recompute would cancel it anyway, silently.
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith('m-1');
  });
});

describe('JOB 4 — the earned moment, and only the earned moment', () => {
  test('turning a circle alarm ON is what asks for permission', async () => {
    mockNative.getAuthorizationState.mockResolvedValue('notDetermined');
    await setCircleAlarm({
      membershipId: 'm-1',
      circleId: 'c-1',
      circleName: 'Morning pages',
      enabled: true,
      time: '07:30:00',
    });
    expect(mockNative.requestAuthorization).toHaveBeenCalledTimes(1);
  });

  test('APP START never prompts, even with an alarm waiting to be armed', async () => {
    mockNative.getAuthorizationState.mockResolvedValue('notDetermined');
    await syncCircleAlarms({ userId: 'u-1' });
    // PN1's law: the background re-arm can only ever schedule against a
    // permission already granted. A cold prompt on launch is the fastest
    // way to lose the permission for good.
    expect(mockNative.requestAuthorization).not.toHaveBeenCalled();
    expect(mockNative.scheduleWeeklyAlarm).not.toHaveBeenCalled();
  });

  test('a denied phone reports it rather than silently no-oping', async () => {
    mockNative.getAuthorizationState.mockResolvedValue('denied');
    await expect(syncCircleAlarms({ userId: 'u-1' })).resolves.toBe('permission-denied');
    await expect(
      setCircleAlarm({
        membershipId: 'm-1',
        circleId: 'c-1',
        circleName: 'Morning pages',
        enabled: true,
        time: '07:30:00',
      })
    ).resolves.toEqual({ status: 'permission-denied' });
  });
});

describe('the reconcile pass — what makes the recompute self-healing', () => {
  test('an alarm the database no longer knows about is cancelled', async () => {
    // e.g. a circle left while the app was offline: the membership row is
    // gone, so the plan cannot contain its id, but AlarmKit still holds it.
    mockNative.listAlarmIds.mockResolvedValue(['m-1', 'm-GONE']);
    await syncCircleAlarms({ userId: 'u-1' });
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith('m-GONE');
    expect(mockNative.cancelAlarm).not.toHaveBeenCalledWith('m-1');
  });

  test('the surviving alarm is re-armed from scratch, all seven days', async () => {
    await syncCircleAlarms({ userId: 'u-1' });
    expect(mockNative.scheduleWeeklyAlarm).toHaveBeenCalledWith(
      'm-1',
      7,
      30,
      [0, 1, 2, 3, 4, 5, 6],
      expect.stringContaining('Morning pages'),
      expect.any(String)
    );
  });

  test('cancelling happens BEFORE scheduling, so a device at its ceiling frees a slot first', async () => {
    const order: string[] = [];
    mockNative.listAlarmIds.mockResolvedValue(['m-GONE']);
    mockNative.cancelAlarm.mockImplementation(async () => {
      order.push('cancel');
    });
    mockNative.scheduleWeeklyAlarm.mockImplementation(async () => {
      order.push('schedule');
    });
    await syncCircleAlarms({ userId: 'u-1' });
    expect(order).toEqual(['cancel', 'schedule']);
  });

  test('turning OFF cancels the alarm before it writes — an off switch must not need the network', async () => {
    const order: string[] = [];
    mockNative.cancelAlarm.mockImplementation(async () => {
      order.push('cancel');
    });
    (supabase.rpc as jest.Mock).mockImplementationOnce(async () => {
      order.push('write');
      return { error: null };
    });
    const res = await setCircleAlarm({
      membershipId: 'm-1',
      circleId: 'c-1',
      circleName: 'Morning pages',
      enabled: false,
      time: null,
    });
    expect(res).toEqual({ status: 'off' });
    expect(order).toEqual(['cancel', 'write']);
    expect(supabase.rpc).toHaveBeenCalledWith('set_circle_alarm', {
      p_circle_id: 'c-1',
      p_enabled: false,
      p_time: null,
    });
  });
});
