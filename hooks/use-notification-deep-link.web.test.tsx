/**
 * EM1 job 2 — WEB TOUCHES THE NATIVE MODULE NOT AT ALL.
 *
 * PN1 is iOS-only: there is no APNs path on web, so there is no tap to
 * respond to either. The hook still MOUNTS on web (it sits in the shared
 * `(app)` layout), so the claim worth pinning is that mounting it there
 * reaches for nothing — the same split, and the same reason, as the
 * lib/alarmReminder web/native test pair.
 *
 * Platform.OS is overridden because jest-expo's own default is 'ios',
 * which is what use-notification-deep-link.test.tsx relies on.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';

// react-native is replaced WHOLESALE rather than spread over
// requireActual: pulling in the real module here drags TurboModule
// lookups ('DevMenu') that do not exist under Jest. The hook only ever
// touches Platform, and the probe below renders null, so nothing else is
// needed — the same shape lib/alarmReminder.web.test.ts uses.
jest.mock('react-native', () => ({
  Platform: { OS: 'web', select: (spec: Record<string, unknown>) => spec.web ?? spec.default },
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockGetLast = jest.fn();
const mockAddListener = jest.fn();
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  getLastNotificationResponseAsync: () => mockGetLast(),
  clearLastNotificationResponseAsync: jest.fn(),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddListener(cb),
}));

jest.mock('@/lib/sentry', () => ({ captureError: jest.fn() }));

import { useNotificationDeepLink } from './use-notification-deep-link';

function Probe() {
  useNotificationDeepLink(true);
  return null;
}

it('mounts on web and reaches for nothing', async () => {
  await act(async () => {
    create(<Probe />);
  });

  expect(mockGetLast).not.toHaveBeenCalled();
  expect(mockAddListener).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});
