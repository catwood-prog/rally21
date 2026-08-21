/**
 * DA1 (21 Aug, from Cat's device) — A ZERO-CIRCLE ACCOUNT CAN REACH ITS
 * OWN DELETION.
 *
 * THE DEFECT THIS PINS. Cat removed catherine@amsadvisory.co.uk from all
 * its circles and then could not delete it. `app/(app)/_layout.tsx`
 * redirected any 'needs-circle' account to `/onboarding/circle-setup`,
 * and that redirect governs EVERY route in the `(app)` group — settings
 * and `your-data` included. The whole delete flow (typed DELETE →
 * `deleteMyAccount()` → the `delete-account` edge function) lives on
 * `your-data`, finished and correct, and was structurally unreachable for
 * exactly the person it exists for. It traps a signup abandoned at the
 * fork, a Hide My Email duplicate, and anyone who left their last circle.
 * Apple 5.1.1(v) requires in-app deletion to be findable.
 *
 * WHY THE TEST IS SHAPED LIKE THIS, and it is the transferable part:
 * every unit here was already correct. `your-data` rendered its danger
 * zone; settings linked to it; the guard did precisely what it was
 * written to do. The bug was the ROUTE — a class no single unit's test
 * can see, the same class `invite-arrival-existing-account.test.tsx` was
 * written for. So this walks the CHAIN: it takes the destination
 * circle-setup's new affordance actually pushes, feeds that destination
 * to the real guard, takes the destination settings actually pushes,
 * feeds THAT to the real guard, and only then asserts the delete button
 * is on screen. Nothing is asserted about a screen in isolation; the
 * assertion is that the four are connected end to end.
 *
 * The negative control matters as much as the walk: the guard was
 * NARROWED, not opened. A circle-less account opening Today must still
 * land at the fork.
 *
 * NOT co-located under app/ — see screens-tests/today.test.tsx's note: a
 * test file inside app/ is compiled into the production bundle.
 */
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { STRINGS } from '@/constants/strings';

const USER = '8174d14d-01d4-4371-8b3e-c0647ce2f23f';

/** What `(app)/_layout` redirected to on the last render, or null if it
 * let the Stack through. `mock`-prefixed so the hoisted factory may read
 * it. */
let mockRedirects: string[] = [];
/** The onboarding status the layout sees, reassigned per case. */
let mockStatus = 'needs-circle';
/** The route the layout is deciding about, as expo-router's own segments. */
let mockSegments: string[] = [];
let mockSession: { user: { id: string } } | null = { user: { id: USER } };
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  // Redirect renders nothing; the destination IS the behaviour under test.
  Redirect: ({ href }: { href: string }) => {
    mockRedirects.push(href);
    return null;
  },
  // The Stack is the "let them through" answer, so it needs to be
  // distinguishable from a redirect and nothing more.
  Stack: () => null,
  useSegments: () => mockSegments,
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(cb, [cb]);
  },
}));

jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ session: mockSession, isLoading: false, signOut: jest.fn() }),
}));
jest.mock('@/hooks/use-onboarding-status', () => ({
  useOnboardingStatus: () => ({ status: mockStatus, refresh: jest.fn() }),
}));
jest.mock('@/hooks/use-notification-deep-link', () => ({ useNotificationDeepLink: jest.fn() }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// --- circle-setup's dependencies ------------------------------------
jest.mock('@/lib/funnel', () => ({ recordFunnelEvent: jest.fn() }));
jest.mock('@/lib/invite-link', () => ({ takePendingInviteCode: jest.fn(async () => null) }));

// --- settings' dependencies (the set settings-push-row.test.tsx uses) --
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/lib/profile', () => ({
  getMyProfile: jest.fn(async () => ({
    id: USER,
    name: 'Ash',
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
  // your-data's own use of the same module.
  removeAvatar: jest.fn(async () => {}),
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
jest.mock('@/lib/moderation', () => ({ getMyBlocks: jest.fn(async () => []), unblockUser: jest.fn(async () => {}) }));
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
  getPushPermissionStatus: jest.fn(async () => 'undetermined'),
  isThisDeviceRegisteredForPush: jest.fn(async () => false),
  registerForPushNotificationsAsync: jest.fn(async () => 'undetermined'),
}));

// --- your-data's dependencies ---------------------------------------
jest.mock('@/lib/account', () => ({ deleteMyAccount: jest.fn(async () => {}) }));
jest.mock('@/lib/yourData', () => ({
  // THE FIXTURE IS THE SUBJECT: zero circles. This is the person the
  // section is about.
  getDataSummary: jest.fn(async () => ({
    name: 'Ash',
    joinedDate: '2026-08-01T00:00:00.000Z',
    circleCount: 0,
    checkinCount: 0,
    reflectionCount: 0,
    hasPrivateMap: false,
    conversationMessageCount: 0,
    notificationPrefs: { nudgeEnabled: true, friendNudgeEnabled: true, digestEnabled: true },
  })),
  exportMyData: jest.fn(async () => ({})),
}));

/** Every string the rendered tree actually put on screen. */
function visibleText(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((c): c is string => typeof c === 'string');
}

async function render(mod: string): Promise<ReactTestRenderer> {
  // Required inside the call, never imported at module scope, so the
  // fixtures above are initialised before the mock factories run.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Screen = require(mod).default as React.ComponentType;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(React.createElement(Screen));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return tree;
}

/**
 * Ask the REAL `(app)/_layout` where a given route lands, for a given
 * account state. Returns the redirect destination, or null when the
 * layout let the route render.
 *
 * The `/path` → segments mapping is expo-router's own file layout, which
 * this test states explicitly rather than importing: `app/(app)/settings.tsx`
 * is `['(app)', 'settings']`, `app/(app)/(tabs)/today.tsx` is
 * `['(app)', '(tabs)', 'today']`.
 */
const SEGMENTS: Record<string, string[]> = {
  '/today': ['(app)', '(tabs)', 'today'],
  '/circle': ['(app)', '(tabs)', 'circle'],
  '/checkin': ['(app)', 'checkin'],
  '/my-practices': ['(app)', 'my-practices'],
  '/settings': ['(app)', 'settings'],
  '/your-data': ['(app)', 'your-data'],
};

async function guardVerdict(path: string): Promise<string | null> {
  mockSegments = SEGMENTS[path];
  if (!mockSegments) throw new Error(`no segments recorded for ${path}`);
  mockRedirects = [];
  const tree = await render('@/app/(app)/_layout');
  const verdict = mockRedirects.length ? mockRedirects[mockRedirects.length - 1] : null;
  await act(async () => tree.unmount());
  return verdict;
}

beforeEach(() => {
  mockRedirects = [];
  mockPush.mockClear();
  mockSession = { user: { id: USER } };
  mockStatus = 'needs-circle';
});

describe('DA1 — the walk out, for an account with no circle', () => {
  it('THE CHAIN: the fork → settings → your data → the delete button, every hop admitted by the real guard', async () => {
    // HOP 1 — the fork is where a circle-less account is held. It now
    // carries one door, and this reads the destination off the real
    // control rather than assuming it.
    const fork = await render('@/app/onboarding/circle-setup');
    const door = fork.root
      .findAllByType(TouchableOpacity)
      .find((n) => n.props.accessibilityLabel === 'settings');
    expect(door).toBeDefined();
    await act(async () => door!.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/settings');
    const toSettings = mockPush.mock.calls[0][0] as string;
    await act(async () => fork.unmount());

    // HOP 2 — the guard must admit that destination. This is the line
    // that fails against HEAD.
    expect(await guardVerdict(toSettings)).toBeNull();

    // HOP 3 — and settings must offer the next hop. Read off the real row.
    mockPush.mockClear();
    const settings = await render('@/app/(app)/settings');
    const dataRow = settings.root
      .findAllByType(TouchableOpacity)
      .find((n) => n.findAllByType(Text).some((t) => t.props.children === STRINGS.yourDataSettingsRow));
    expect(dataRow).toBeDefined();
    await act(async () => dataRow!.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/your-data');
    const toYourData = mockPush.mock.calls[0][0] as string;
    await act(async () => settings.unmount());

    // HOP 4 — the guard must admit that one too. Also fails against HEAD.
    expect(await guardVerdict(toYourData)).toBeNull();

    // THE DESTINATION — the danger zone, on screen, for an account whose
    // own data summary says zero circles.
    const yourData = await render('@/app/(app)/your-data');
    expect(visibleText(yourData)).toContain(STRINGS.yourDataDeleteAccountCta);

    // And the typed-DELETE confirm really opens from it: the button is
    // live, not merely rendered.
    const deleteCta = yourData.root
      .findAllByType(TouchableOpacity)
      .find((n) => n.findAllByType(Text).some((t) => t.props.children === STRINGS.yourDataDeleteAccountCta));
    await act(async () => deleteCta!.props.onPress());
    expect(visibleText(yourData)).toContain(STRINGS.yourDataDeleteAccountTypeToConfirmLabel);
    await act(async () => yourData.unmount());
  });

  it('NEGATIVE CONTROL: the guard was narrowed, not opened — Today still goes to the fork', async () => {
    expect(await guardVerdict('/today')).toBe('/onboarding/circle-setup');
    expect(await guardVerdict('/circle')).toBe('/onboarding/circle-setup');
    expect(await guardVerdict('/checkin')).toBe('/onboarding/circle-setup');
    // Named deliberately: my-practices is NOT in the allowlist. A
    // circle-less account tapping it from settings still lands at the
    // fork, and that is this section's scope edge, not an oversight.
    expect(await guardVerdict('/my-practices')).toBe('/onboarding/circle-setup');
  });

  it("a ready account's paths are untouched", async () => {
    mockStatus = 'ready';
    expect(await guardVerdict('/today')).toBeNull();
    expect(await guardVerdict('/circle')).toBeNull();
    expect(await guardVerdict('/checkin')).toBeNull();
    expect(await guardVerdict('/my-practices')).toBeNull();
    expect(await guardVerdict('/settings')).toBeNull();
    expect(await guardVerdict('/your-data')).toBeNull();
  });

  it('the guards ABOVE needs-circle are untouched: no session, and an unfinished profile', async () => {
    mockSession = null;
    expect(await guardVerdict('/your-data')).toBe('/sign-in');

    mockSession = { user: { id: USER } };
    mockStatus = 'needs-profile';
    expect(await guardVerdict('/your-data')).toBe('/onboarding/profile');
    mockStatus = 'needs-reminders-ask';
    expect(await guardVerdict('/your-data')).toBe('/onboarding/reminders');
  });
});
