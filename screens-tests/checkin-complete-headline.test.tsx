/**
 * DD1 (5 Aug, Cat's ruling) — THE CELEBRATION MUST NOT CLAIM A DAY IT CAN
 * SEE IS STILL OPEN.
 *
 * THE DEFECT THIS PINS, from Cat's 03:48 screenshot: "day 12 done" as the
 * headline, and eight pixels below it a button reading "one more today".
 * Both lines were correct about their own question and the screen was
 * incoherent anyway, because "done" is a claim about the DAY and
 * checkin-complete fires on EVERY check-in.
 *
 * WHY A RENDER TEST AND NOT ONLY THE UNIT ONES. `successTitleFor` is pure
 * and its four cases are pinned beside it in
 * app/(app)/checkin-complete.test.tsx. What that cannot show is the thing
 * that was actually wrong: two lines on one screen disagreeing. This
 * walks the real screen through a real two-circle day — first check-in,
 * then second — and reads the headline and the button OUT OF THE SAME
 * RENDERED TREE, so the pairing is what is asserted, not each half alone.
 * That is VERIFY step 2's "both sides walked on a unit-render".
 *
 * The data is the screenshot's own shape: two active circles, a rally
 * count of 12, no milestone, no card due. `getCirclePresence` is the only
 * thing that differs between the two cases — the first check-in has a row
 * in circle A and none in circle B, the second has both.
 *
 * NOT co-located under app/ — see screens-tests/today.test.tsx's note:
 * a test file inside app/ becomes a route in the production bundle.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { STRINGS } from '@/constants/strings';

const ME = '8174d14d-01d4-4371-8b3e-c0647ce2f23f';
const CIRCLE_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const CIRCLE_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const TODAY = '2026-08-05';
const RALLY_COUNT = 12;

const circle = (id: string, name: string) => ({
  id,
  name,
  timeOfDay: null,
  startDate: '2026-07-25',
  durationDays: 21,
  practiceName: 'Walk 20 minutes',
  practiceIsUserCreated: false,
  durationMinutes: 20,
  inviteCode: 'AAAAAA',
  createdBy: ME,
  resourceUrl: null,
  instructions: null,
  isPublic: false,
  closedToJoins: false,
  ralliedOnAt: null,
  completedAt: null,
  myJoinSource: 'creator',
  wallSeenAt: null,
  myFinishedAt: null,
});

const mockCircles = [circle(CIRCLE_A, 'Morning Movers'), circle(CIRCLE_B, 'Evening Pages')];

/** Which circles I have a row in today — reassigned per test case, which
 * is the ONLY difference between the day's first check-in and its last.
 * `mock`-prefixed because a jest.mock factory below reads it, and that is
 * the one out-of-scope reference babel-plugin-jest-hoist permits. */
let mockPresentIn: string[] = [];

/** My own self check-in row for today, in the shape getCirclePresence
 * really returns. */
const mockMyRowToday = {
  userId: ME,
  localDate: TODAY,
  kind: 'self' as const,
  coveredBy: null,
  createdAt: `${TODAY}T09:00:00.000Z`,
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ circleId: 'aaaaaaaa-0000-4000-8000-000000000001' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: '8174d14d-01d4-4371-8b3e-c0647ce2f23f' } } }),
}));

jest.mock('@/lib/date', () => ({
  ...jest.requireActual('@/lib/date'),
  getLocalDateString: () => '2026-08-05',
}));

jest.mock('@/lib/circle', () => ({
  ...jest.requireActual('@/lib/circle'),
  getCircleById: jest.fn(async (id: string) => mockCircles.find((c) => c.id === id) ?? null),
  listMyCircles: jest.fn(async () => mockCircles),
  getCirclePresence: jest.fn(async (id: string) =>
    mockPresentIn.includes(id) ? [mockMyRowToday] : []
  ),
}));

jest.mock('@/lib/journey', () => ({
  ...jest.requireActual('@/lib/journey'),
  getMyRallyCount: jest.fn(async () => 12),
}));

jest.mock('@/lib/glow', () => ({
  ...jest.requireActual('@/lib/glow'),
  // No milestone and no glow beat: the plainest possible celebration, so
  // the headline is the only thing under test.
  checkGlowMilestone: jest.fn(async () => null),
  getMyWeek: jest.fn(async () => []),
}));

jest.mock('@/lib/shareCards', () => ({
  ...jest.requireActual('@/lib/shareCards'),
  // No card due, so the day-done case reaches its own farewell rather
  // than the card's hand-off label.
  getShareCardForToday: jest.fn(async () => null),
}));

jest.mock('@/lib/warmth', () => ({
  ...jest.requireActual('@/lib/warmth'),
  getFreshWarmth: jest.fn(async () => []),
  markWarmthSeen: jest.fn(async () => {}),
}));

jest.mock('@/lib/profile', () => ({
  getMyProfile: jest.fn(async () => ({ sounds_enabled: false, has_seen_push_prompt: true })),
  markPushPromptSeen: jest.fn(async () => {}),
}));

jest.mock('@/lib/pushNotifications', () => ({
  getPushPermissionStatus: jest.fn(async () => 'granted'),
  registerForPushNotificationsAsync: jest.fn(async () => 'granted'),
}));

jest.mock('@/lib/chime', () => ({ playCheckinPop: jest.fn(), unlockAudioContext: jest.fn() }));

jest.mock('@/lib/checkin', () => ({
  ...jest.requireActual('@/lib/checkin'),
  countMyCircleCompletions: jest.fn(async () => 12),
}));

/** Every string the rendered tree actually put on screen. */
function visibleText(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((c): c is string => typeof c === 'string');
}

async function renderCelebration(): Promise<{ tree: ReactTestRenderer; texts: string[] }> {
  // Required here, not imported at module scope, so the fixtures above
  // are initialised before the mock factories run.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const CheckInComplete = require('@/app/(app)/checkin-complete').default as React.ComponentType;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(React.createElement(CheckInComplete));
  });
  // Let the fetches settle: the day-close read is a circle list AND a
  // presence call per circle, so one flush is not enough.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { tree, texts: visibleText(tree) };
}

describe('the check-in celebration, on a two-circle day (DD1)', () => {
  let tree: ReactTestRenderer;

  afterEach(() => {
    act(() => tree.unmount());
  });

  it('FIRST check-in: the headline is the count alone, and the button asks for the rest', async () => {
    mockPresentIn = [CIRCLE_A];
    const rendered = await renderCelebration();
    tree = rendered.tree;

    // THE SCREENSHOT, fixed. Both lines come out of the same tree, so
    // this is the pairing that was wrong, not two separate facts.
    expect(rendered.texts).toContain(STRINGS.checkinSuccessTitleOpen(RALLY_COUNT));
    expect(rendered.texts).toContain(STRINGS.checkinMoreTodayCta(1));
    // The claim is absent — not merely different.
    expect(rendered.texts).not.toContain(STRINGS.checkinSuccessTitle(RALLY_COUNT));
    expect(rendered.texts.some((t) => t.includes('done'))).toBe(false);
    // The body line is untouched by DD1.
    expect(rendered.texts).toContain(STRINGS.checkinSuccessBody);
  });

  it('SECOND check-in, the day’s last: the headline earns "done" and the button says goodbye', async () => {
    mockPresentIn = [CIRCLE_A, CIRCLE_B];
    const rendered = await renderCelebration();
    tree = rendered.tree;

    expect(rendered.texts).toContain(STRINGS.checkinSuccessTitle(RALLY_COUNT));
    expect(rendered.texts).toContain(STRINGS.dayDoneCta);
    expect(rendered.texts).toContain(STRINGS.checkinSuccessBody);
  });

  it('a FINISHED circle is not a circle still waiting — the day closes on the one live one', async () => {
    // PA2's personal ceremony. today.tsx never asks a finished member to
    // check in, so nothing is outstanding here and the headline says so.
    const finished = { ...circle(CIRCLE_B, 'Evening Pages'), myFinishedAt: '2026-07-30T00:00:00Z' };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { listMyCircles } = require('@/lib/circle');
    (listMyCircles as jest.Mock).mockResolvedValueOnce([mockCircles[0], finished]);
    mockPresentIn = [CIRCLE_A];

    const rendered = await renderCelebration();
    tree = rendered.tree;

    expect(rendered.texts).toContain(STRINGS.checkinSuccessTitle(RALLY_COUNT));
    expect(rendered.texts).not.toContain(STRINGS.checkinMoreTodayCta(1));
  });
});
