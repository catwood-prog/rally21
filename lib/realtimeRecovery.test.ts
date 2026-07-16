import { AppState, type AppStateStatus } from 'react-native';

import {
  createRealtimeStatusGate,
  REALTIME_REPORT_AFTER_FAILURES,
  subscribeToAppWake,
} from './realtimeRecovery';

describe('createRealtimeStatusGate', () => {
  it('a clean first join neither refetches nor reports', () => {
    const gate = createRealtimeStatusGate();
    expect(gate('SUBSCRIBED')).toEqual({ refetch: false, reportFailureCount: null });
  });

  it('a single TIMED_OUT is weather — no report', () => {
    const gate = createRealtimeStatusGate();
    expect(gate('TIMED_OUT')).toEqual({ refetch: false, reportFailureCount: null });
  });

  it('a single CHANNEL_ERROR is weather — no report', () => {
    const gate = createRealtimeStatusGate();
    expect(gate('CHANNEL_ERROR')).toEqual({ refetch: false, reportFailureCount: null });
  });

  it('recovering after a failed first join refetches (the load ran before the channel was listening)', () => {
    const gate = createRealtimeStatusGate();
    gate('TIMED_OUT');
    expect(gate('SUBSCRIBED')).toEqual({ refetch: true, reportFailureCount: null });
  });

  it('recovering after a mid-session drop refetches exactly on the recovery, not on later statuses', () => {
    const gate = createRealtimeStatusGate();
    gate('SUBSCRIBED');
    gate('TIMED_OUT');
    expect(gate('SUBSCRIBED')).toEqual({ refetch: true, reportFailureCount: null });
    // steady-state after recovery: nothing more
    expect(gate('SUBSCRIBED')).toEqual({ refetch: false, reportFailureCount: null });
  });

  it(`reports exactly at ${REALTIME_REPORT_AFTER_FAILURES} consecutive failures, with the count`, () => {
    const gate = createRealtimeStatusGate();
    gate('SUBSCRIBED');
    expect(gate('TIMED_OUT').reportFailureCount).toBeNull();
    expect(gate('TIMED_OUT').reportFailureCount).toBeNull();
    expect(gate('TIMED_OUT').reportFailureCount).toBe(3);
  });

  it('mixed TIMED_OUT and CHANNEL_ERROR count toward the same streak', () => {
    const gate = createRealtimeStatusGate();
    gate('TIMED_OUT');
    gate('CHANNEL_ERROR');
    expect(gate('TIMED_OUT').reportFailureCount).toBe(3);
  });

  it('reports once per streak — failures past the threshold stay quiet', () => {
    const gate = createRealtimeStatusGate();
    gate('TIMED_OUT');
    gate('TIMED_OUT');
    expect(gate('TIMED_OUT').reportFailureCount).toBe(3);
    expect(gate('TIMED_OUT').reportFailureCount).toBeNull();
    expect(gate('TIMED_OUT').reportFailureCount).toBeNull();
  });

  it('a recovery resets the streak — two separate short streaks never report', () => {
    const gate = createRealtimeStatusGate();
    gate('TIMED_OUT');
    gate('TIMED_OUT');
    gate('SUBSCRIBED'); // recovered at 2 — streak resets
    gate('TIMED_OUT');
    expect(gate('TIMED_OUT').reportFailureCount).toBeNull();
    expect(gate('TIMED_OUT').reportFailureCount).toBe(3);
  });

  it('a full streak can report again after a recovery (new streak, new report)', () => {
    const gate = createRealtimeStatusGate();
    gate('TIMED_OUT');
    gate('TIMED_OUT');
    expect(gate('TIMED_OUT').reportFailureCount).toBe(3);
    expect(gate('SUBSCRIBED').refetch).toBe(true);
    gate('TIMED_OUT');
    gate('TIMED_OUT');
    expect(gate('TIMED_OUT').reportFailureCount).toBe(3);
  });

  it('CLOSED is neutral — not a failure, not a recovery, and it does not reset the streak', () => {
    const gate = createRealtimeStatusGate();
    expect(gate('CLOSED')).toEqual({ refetch: false, reportFailureCount: null });
    gate('TIMED_OUT');
    gate('TIMED_OUT');
    expect(gate('CLOSED')).toEqual({ refetch: false, reportFailureCount: null });
    expect(gate('TIMED_OUT').reportFailureCount).toBe(3);
  });

  it('honors a custom threshold', () => {
    const gate = createRealtimeStatusGate(1);
    expect(gate('TIMED_OUT').reportFailureCount).toBe(1);
  });
});

describe('subscribeToAppWake', () => {
  it('refetches on active, ignores background/inactive, and stops after unsubscribe', () => {
    const remove = jest.fn();
    let handler: ((state: AppStateStatus) => void) | undefined;
    const addEventListener = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, fn) => {
        handler = fn;
        return { remove } as ReturnType<typeof AppState.addEventListener>;
      });

    try {
      const refetch = jest.fn();
      const unsubscribe = subscribeToAppWake(refetch);
      expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

      handler!('background');
      handler!('inactive');
      expect(refetch).not.toHaveBeenCalled();

      handler!('active');
      expect(refetch).toHaveBeenCalledTimes(1);

      unsubscribe();
      expect(remove).toHaveBeenCalledTimes(1);
    } finally {
      addEventListener.mockRestore();
    }
  });
});
