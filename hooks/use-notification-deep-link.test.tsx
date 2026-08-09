/**
 * EM1 job 2 — the tap handler, driven through the REAL hook.
 *
 * lib/notificationDeepLink.test.ts already pins WHERE a payload sends
 * someone. What has to hold here is behaviour across the two entry
 * points a tap actually arrives through, and it cannot be read off the
 * pure function: the COLD launch response is not an event but a stored
 * value, so the thing most likely to go wrong is reading it twice — once
 * on the tap and again on every ordinary launch afterwards, which would
 * yank someone into a cover screen they closed days ago. That is what
 * `clearLastNotificationResponseAsync` is for, and it is pinned below.
 *
 * Every mock binding is `mock`-prefixed because jest's module factories
 * may not reference out-of-scope variables otherwise.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';
let mockListener: ((response: unknown) => void) | null = null;
const mockRemove = jest.fn();
const mockGetLast = jest.fn();
const mockClearLast = jest.fn(() => Promise.resolve());

jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  getLastNotificationResponseAsync: () => mockGetLast(),
  clearLastNotificationResponseAsync: () => mockClearLast(),
  addNotificationResponseReceivedListener: (cb: (response: unknown) => void) => {
    mockListener = cb;
    return { remove: mockRemove };
  },
}));

const mockCaptureError = jest.fn();
jest.mock('@/lib/sentry', () => ({
  captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

import { useNotificationDeepLink } from './use-notification-deep-link';

function response(data: Record<string, unknown>, opts: { id?: string; action?: string } = {}) {
  return {
    actionIdentifier: opts.action ?? DEFAULT_ACTION,
    notification: {
      request: { identifier: opts.id ?? 'notif-1', content: { data } },
    },
  };
}

const ASK = {
  type: 'ember_ask',
  circleId: 'circle-1',
  memberId: 'member-1',
  memberName: 'Russ',
  myName: 'Cat',
  missedDate: '2026-08-08',
};

function Probe({ enabled }: { enabled: boolean }) {
  useNotificationDeepLink(enabled);
  return <Text>probe</Text>;
}

async function render(enabled = true) {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<Probe enabled={enabled} />);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListener = null;
  mockGetLast.mockResolvedValue(null);
  mockClearLast.mockResolvedValue(undefined);
});

describe('useNotificationDeepLink', () => {
  it('a WARM tap (app already running) opens the cover flow', async () => {
    await render();
    await act(async () => {
      mockListener!(response(ASK));
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/cover',
      params: {
        circleId: 'circle-1',
        memberId: 'member-1',
        memberName: 'Russ',
        myName: 'Cat',
        missedDate: '2026-08-08',
      },
    });
  });

  it('a COLD tap (app launched by the notification) opens it too', async () => {
    mockGetLast.mockResolvedValue(response(ASK));
    await render();

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0].pathname).toBe('/cover');
  });

  it('CONSUMES the stored launch response, so the next ordinary launch does not re-open it', async () => {
    mockGetLast.mockResolvedValue(response(ASK));
    await render();

    expect(mockClearLast).toHaveBeenCalledTimes(1);
  });

  it('clears the stored response even when it routes nowhere', async () => {
    mockGetLast.mockResolvedValue(response({ type: 'nudge_daily' }));
    await render();

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockClearLast).toHaveBeenCalledTimes(1);
  });

  it('never clears when there was no stored response at all', async () => {
    await render();
    expect(mockClearLast).not.toHaveBeenCalled();
  });

  it('the same tap arriving twice navigates once', async () => {
    mockGetLast.mockResolvedValue(response(ASK, { id: 'notif-7' }));
    await render();
    await act(async () => {
      mockListener!(response(ASK, { id: 'notif-7' }));
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('a dismissal is not a request to go anywhere', async () => {
    await render();
    await act(async () => {
      mockListener!(response(ASK, { action: 'expo.modules.notifications.actions.DISMISS' }));
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does nothing at all while disabled — a tap must never race the sign-in redirect', async () => {
    mockGetLast.mockResolvedValue(response(ASK));
    await render(false);

    expect(mockGetLast).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockListener).toBeNull();
  });

  it('a failed cold read is REPORTED, never swallowed (FF1 rule 3)', async () => {
    mockGetLast.mockRejectedValue(new Error('no native module'));
    await render();

    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount', async () => {
    const tree = await render();
    await act(async () => {
      tree.unmount();
    });

    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
