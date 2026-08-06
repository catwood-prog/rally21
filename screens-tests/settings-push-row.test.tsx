/**
 * PN2 job 2 — THE INERT CONTROL, WALKED.
 *
 * The defect, from live data: an account with the OS permission granted
 * and no `device_tokens` row rendered the push pill as "on", ignored
 * every tap (`handlePushRowPress` early-returned on 'granted'), and
 * delivered nothing, forever, with no surface anywhere that could say so.
 *
 * WHY A RENDER TEST. The two halves are provable separately — the library
 * half is pinned in lib/pushNotifications.test.ts — but the bug WAS the
 * pairing: a pill claiming one thing while the database said another, and
 * a handler whose guard read the wrong one of the two. So this walks the
 * real screen: it reads the pill and the helper out of the same rendered
 * tree, taps the real TouchableOpacity, and asserts what the tap did.
 *
 * That is VERIFY step 2's second forced path — granted-but-unregistered
 * recovering on tap, not reasoned from source.
 *
 * NOT co-located under app/ — see screens-tests/today.test.tsx's note: a
 * test file inside app/ becomes a route in the production bundle.
 */
import React from 'react';
import { Linking, Text, TouchableOpacity } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { STRINGS } from '@/constants/strings';

/** The two answers the push row now needs, reassigned per case. Both are
 * `mock`-prefixed because the jest.mock factory below reads them, which is
 * the one out-of-scope reference babel-plugin-jest-hoist permits. */
let mockPermission: 'granted' | 'denied' | 'undetermined' = 'granted';
let mockRegistered = false;
/** Set by the register mock, so a test can assert the tap re-registered. */
let mockRegisterCalls = 0;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(cb, [cb]);
  },
}));

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    session: { user: { id: '8174d14d-01d4-4371-8b3e-c0647ce2f23f' } },
    signOut: jest.fn(),
  }),
}));

jest.mock('@/lib/profile', () => ({
  getMyProfile: jest.fn(async () => ({
    id: '8174d14d-01d4-4371-8b3e-c0647ce2f23f',
    name: 'Cat',
    avatar_url: null,
    sounds_enabled: true,
    reflections_opt_out: false,
    alarm_enabled: false,
    alarm_time: null,
    away_since: null,
    celebrate_birthday: true,
    birth_month: null,
    birth_day: null,
    birth_year: null,
  })),
  saveProfile: jest.fn(async () => ({ avatarWarning: null })),
  saveBirthday: jest.fn(async () => {}),
  setAlarmReminder: jest.fn(async () => {}),
  setCelebrateBirthday: jest.fn(async () => {}),
  setReflectionsOptOut: jest.fn(async () => {}),
  setSoundsEnabled: jest.fn(async () => {}),
}));

jest.mock('@/lib/notifications', () => ({
  getMyNotificationPrefs: jest.fn(async () => ({
    nudgeEnabled: true,
    friendNudgeEnabled: true,
    digestEnabled: true,
    nudgeTime: null,
    quietStart: '21:00:00',
    quietEnd: '07:00:00',
  })),
  updateNotificationPrefs: jest.fn(async () => {}),
}));

jest.mock('@/lib/moderation', () => ({
  getMyBlocks: jest.fn(async () => []),
  unblockUser: jest.fn(async () => {}),
}));

jest.mock('@/lib/shareCards', () => ({
  ...jest.requireActual('@/lib/shareCards'),
  getMyMutedCardFlavors: jest.fn(async () => []),
  setCardFlavorMuted: jest.fn(async () => {}),
}));

jest.mock('@/lib/away', () => ({ setAway: jest.fn(async () => {}), returnFromAway: jest.fn(async () => {}) }));

jest.mock('@/lib/alarmReminder', () => ({
  ...jest.requireActual('@/lib/alarmReminder'),
  syncDailyReminder: jest.fn(async () => ({ scheduled: 0, permissionDenied: false })),
}));

jest.mock('@/lib/pushNotifications', () => ({
  getPushPermissionStatus: jest.fn(async () => mockPermission),
  isThisDeviceRegisteredForPush: jest.fn(async () => mockRegistered),
  registerForPushNotificationsAsync: jest.fn(async () => {
    mockRegisterCalls += 1;
    // What a successful re-registration does: the row appears.
    mockRegistered = true;
    return mockPermission;
  }),
}));

/** Every string the rendered tree actually put on screen. */
function visibleText(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((c): c is string => typeof c === 'string');
}

/** The push row's pill: the one TouchableOpacity whose rendered label is
 * 'on'/'off' and which sits in the row carrying the push label. Found by
 * walking up from the helper text so it cannot collide with the other
 * pref pills (nudges, friend nudges, digest) on the same screen. */
function pushPill(tree: ReactTestRenderer): { node: ReturnType<typeof pillOf>; label: string } {
  const node = pillOf(tree);
  const labels = node
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((c): c is string => typeof c === 'string');
  return { node, label: labels[0] };
}

function pillOf(tree: ReactTestRenderer) {
  const row = tree.root
    .findAll(
      (n) =>
        typeof n.type !== 'string' &&
        n.findAllByType(Text).some((t) => t.props.children === STRINGS.pushToggleLabel)
    )
    // The innermost container holding the label — the prefRow itself.
    .reverse()
    .find((n) => n.findAllByType(TouchableOpacity).length === 1);
  if (!row) throw new Error('the push row did not render');
  return row.findByType(TouchableOpacity);
}

async function renderSettings(): Promise<ReactTestRenderer> {
  // Required here, not imported at module scope, so the fixtures above are
  // initialised before the mock factories run.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Settings = require('@/app/(app)/settings').default as React.ComponentType;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(React.createElement(Settings));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return tree;
}

describe('the push row, when granted is not registered (PN2)', () => {
  let tree: ReactTestRenderer;

  beforeEach(() => {
    mockPermission = 'granted';
    mockRegistered = false;
    mockRegisterCalls = 0;
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it('THE LIVE DEFECT: granted with no device_tokens row renders OFF, and the tap recovers', async () => {
    tree = await renderSettings();

    // BEFORE: the pill does not claim a delivery that would not happen —
    // and it is the OFF presentation, not a fourth visual state.
    expect(pushPill(tree).label).toBe('off');
    expect(visibleText(tree)).toContain(STRINGS.pushToggleHelperUndetermined);
    expect(visibleText(tree)).not.toContain(STRINGS.pushToggleHelperGranted);

    // THE TAP that used to do nothing.
    await act(async () => {
      pushPill(tree).node.props.onPress();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockRegisterCalls).toBe(1);
    // AFTER: registered, so now "on" is a true claim.
    expect(pushPill(tree).label).toBe('on');
    expect(visibleText(tree)).toContain(STRINGS.pushToggleHelperGranted);
  });

  it('granted AND registered is unchanged: on, and the tap stays a no-op', async () => {
    mockRegistered = true;
    tree = await renderSettings();

    expect(pushPill(tree).label).toBe('on');
    expect(visibleText(tree)).toContain(STRINGS.pushToggleHelperGranted);

    await act(async () => {
      pushPill(tree).node.props.onPress();
    });

    expect(mockRegisterCalls).toBe(0);
    expect(pushPill(tree).label).toBe('on');
  });

  it('undetermined still asks — PN1 untouched', async () => {
    mockPermission = 'undetermined';
    tree = await renderSettings();

    expect(pushPill(tree).label).toBe('off');
    expect(visibleText(tree)).toContain(STRINGS.pushToggleHelperUndetermined);
    await act(async () => {
      pushPill(tree).node.props.onPress();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockRegisterCalls).toBe(1);
  });

  it('denied still deep-links to iOS Settings and never re-requests — PN1 untouched', async () => {
    mockPermission = 'denied';
    const openSettings = jest.spyOn(Linking, 'openSettings').mockImplementation(async () => {});
    tree = await renderSettings();

    expect(pushPill(tree).label).toBe('off');
    expect(visibleText(tree)).toContain(STRINGS.pushToggleHelperDenied);
    await act(async () => {
      pushPill(tree).node.props.onPress();
    });

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(mockRegisterCalls).toBe(0);
    openSettings.mockRestore();
  });
});
