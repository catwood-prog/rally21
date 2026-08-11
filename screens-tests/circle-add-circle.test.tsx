/**
 * CR1 job 4 (10 Aug) — "+ add a circle" ON THE CIRCLES TAB, AND THE CAP
 * BRANCH BEHIND IT.
 *
 * WHAT THIS PINS, and why it is the branch rather than the button. The link
 * itself is one `TouchableOpacity`; the thing that can go wrong quietly is
 * WHERE IT GOES. `handleAddCircle` lived inline in today.tsx carrying an
 * at-cap redirect, and the section that added a second copy of that link
 * could have added a second copy of the branch with it. Two copies of a cap
 * rule drift, and the way they drift is silent: the screen offers "start
 * another" to someone who is full, they walk the whole create flow, and the
 * server refuses them at the end. So the assertions are the two
 * destinations, from THIS screen, plus the cap actually reaching the cap
 * screen as a param — `/onboarding/circle-cap` prints the number it is
 * handed, and app_caps() is auth.uid()-aware (3 for everyone, higher for
 * the founder allowlist), so a hard-coded 3 would tell the wrong person the
 * wrong thing.
 *
 * THE CAP FIXTURE IS 3 AND THE ACCOUNTS ARE REAL: every account in the
 * cohort except Cat's own sits at 3 of 3, so the at-cap case below is the
 * ordinary case for this button, not the edge.
 *
 * WHY THIS FILE IS NOT CO-LOCATED (BG1, and it shipped a visible bug once):
 * `app/` IS the router, and anything inside the Tabs group becomes a TAB —
 * a co-located `circle.test.tsx` would put a sixth pill on the live floating
 * tab bar. Screen tests live outside `app/` and reach the screen through
 * `require('@/app/(app)/(tabs)/circle')`.
 *
 * WHY THE ERROR BOUNDARY STAYS ON: the export under test is the boundaried
 * one the tab actually renders, so a crash does not throw out of `create()`
 * — it silently lands on the recovery screen and every "did it render?"
 * assertion would pass a broken screen. `swallowedError()` is the guard, and
 * it prints the real error the boundary ate.
 */
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { STRINGS } from '@/constants/strings';
import { captureError } from '@/lib/sentry';

const ME = 'c0a80a1e-0000-4000-8000-000000000001';
const MATE = 'c0a80a1e-0000-4000-8000-000000000002';
const TODAY = '2026-08-10';

const circle = (id: string, name: string) => ({
  id,
  name,
  timeOfDay: null,
  startDate: '2026-07-20',
  durationDays: 21,
  practiceName: name,
  practiceIsUserCreated: false,
  durationMinutes: 10,
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

const ALL_CIRCLES = [
  circle('11111111-1111-4111-8111-111111111111', 'Walk 20 minutes'),
  circle('22222222-2222-4222-8222-222222222222', 'Meditate 10 minutes'),
  circle('33333333-3333-4333-8333-333333333333', 'Write one page'),
];

const member = (userId: string, name: string) => ({
  userId,
  name,
  avatarUrl: null,
  role: userId === ME ? 'owner' : 'member',
  birthMonth: null,
  birthDay: null,
  celebrateBirthday: true,
  timezone: 'Europe/London',
  joinedAt: '2026-07-20T09:00:00.000Z',
  awaySince: null,
  finishedAt: null,
});

/** Mutated per test — the mock factories below read it at CALL time, so a
 * test picks its own circle count and cap before rendering.
 *
 * CR2 adds `mode` and `listFails`. `mode` chooses which of the screen's two
 * branches the resolver lands on, because the whole point of CR2 is that the
 * two are reached by different people: 'picker' is CR1's list, 'single' is
 * where resolveCircleSelection sends anyone with exactly one circle — the
 * only view Russ and Soraya ever see. `circles` is what `listMyCircles`
 * returns on the single path, which is the REAL count the cap branch there
 * has to read; `listFails` makes that read throw. */
const mockState = {
  mode: 'picker' as 'picker' | 'single',
  circles: ALL_CIRCLES,
  cap: 3,
  listFails: false,
};

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    back: jest.fn(),
    setParams: jest.fn(),
  }),
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = require('react');
    useEffect(() => {
      cb();
    }, [cb]);
  },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ addListener: () => () => {} }),
}));

// The screen imports YouTubeEmbed, which pulls react-native-webview's
// native module in at require time — nothing this test renders, but enough
// to fail the whole suite before it starts.
jest.mock('react-native-webview', () => ({ WebView: () => null }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'c0a80a1e-0000-4000-8000-000000000001' } } }),
}));

jest.mock('@/lib/date', () => ({
  ...jest.requireActual('@/lib/date'),
  getLocalDateString: () => '2026-08-10',
}));

jest.mock('@/lib/circle', () => ({
  ...jest.requireActual('@/lib/circle'),
  // Mocked at the RESOLVER, not at listMyCircles: resolveCircleSelection
  // takes its two lookups as a defaulted `deps` argument bound inside the
  // real module, so replacing the module's exported listMyCircles would
  // leave the resolver still calling the real one.
  //
  // CR2 — the resolver is ALSO the seam for the single-circle branch, and
  // that is why this file was extended rather than replaced: the screen's
  // two views differ only by what this returns.
  resolveCircleSelection: jest.fn(async () =>
    mockState.mode === 'single'
      ? { kind: 'single', circle: mockState.circles[0] }
      : { kind: 'picker', circles: mockState.circles }
  ),
  // CR2 — the detail branch reads the count from listMyCircles DIRECTLY
  // (not through the resolver), so this one is mocked at the export, and
  // it is the fixture that decides whether the person is at their cap.
  listMyCircles: jest.fn(async () => {
    if (mockState.listFails) throw new Error('membership read failed');
    return mockState.circles;
  }),
  getCircleMembers: jest.fn(async () => [member(ME, 'Cat'), member(MATE, 'Russ')]),
  getCirclePresence: jest.fn(async () => [
    { userId: MATE, localDate: TODAY, kind: 'self', coveredBy: null, createdAt: `${TODAY}T09:00:00.000Z` },
  ]),
  getCoverableMembers: jest.fn(async () => new Map<string, string>()),
  subscribeToCirclePresence: jest.fn(() => () => {}),
}));

jest.mock('@/lib/caps', () => ({
  ...jest.requireActual('@/lib/caps'),
  getMyCircleCap: jest.fn(async () => mockState.cap),
}));

// CR2 — the rest of the detail branch's load batch. None of it is what the
// test is about; all of it has to resolve or the screen never reaches its
// loaded render. Every value here is the QUIET one (no wall, no glow, no
// pair streak, no block, no cover), so nothing but the add link and the
// screen's own furniture is on the page.
jest.mock('@/lib/wall', () => ({
  ...jest.requireActual('@/lib/wall'),
  getWallPreview: jest.fn(async () => []),
  isFriendNudgeEnabled: jest.fn(async () => true),
  subscribeToWall: jest.fn(() => () => {}),
}));

jest.mock('@/lib/profile', () => ({
  ...jest.requireActual('@/lib/profile'),
  getMyProfile: jest.fn(async () => ({
    has_seen_cover_hint: true,
    has_seen_checkin_consent: true,
    reflections_opt_out: false,
  })),
  markCoverHintSeen: jest.fn(async () => {}),
}));

jest.mock('@/lib/journey', () => ({
  ...jest.requireActual('@/lib/journey'),
  // 0, never null: null is "the marker has not loaded", and the ceremony
  // effect deliberately waits on that — a null here would leave the screen
  // rendered but the effect permanently parked, which is not the state a
  // real single-circle open is in.
  getMyLastCelebratedDay: jest.fn(async () => 0),
}));

jest.mock('@/lib/glow', () => ({
  ...jest.requireActual('@/lib/glow'),
  getPairStreaks: jest.fn(async () => []),
  getGlowForCircleMates: jest.fn(async () => new Map<string, number>()),
}));

jest.mock('@/lib/moderation', () => ({
  ...jest.requireActual('@/lib/moderation'),
  getMyBlocks: jest.fn(async () => []),
}));

/** Every string the rendered tree actually put on screen, in render order. */
function visibleText(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((c): c is string => typeof c === 'string');
}

/** The error the boundary swallowed, if it swallowed one. */
function swallowedError(): string {
  const calls = (captureError as jest.Mock).mock.calls.filter(
    ([, tags]) => tags && 'boundary' in tags
  );
  if (calls.length === 0) return 'none';
  return calls.map(([e]) => (e instanceof Error ? e.message : String(e))).join(' | ');
}

/** The add link, found by its own copy rather than a testID — the same
 * string Today renders, so the two screens cannot drift apart unnoticed. */
function addLink(tree: ReactTestRenderer) {
  return tree.root
    .findAllByType(TouchableOpacity)
    .find((t) => t.findAllByType(Text).some((x) => x.props.children === STRINGS.addCircleLink));
}

describe('the circles tab — "+ add a circle" (CR1)', () => {
  // Required inside the describe, never imported at module scope: jest
  // hoists the mock factories above ES imports, so a top-level import
  // evaluates them while the fixtures above are still in TDZ.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const YourCircle = require('@/app/(app)/(tabs)/circle').default as React.ComponentType;

  let tree: ReactTestRenderer;

  const renderLoaded = async () => {
    await act(async () => {
      tree = create(React.createElement(YourCircle));
    });
    // The per-circle member/presence fetches are a second await inside the
    // first, so one flush is not enough to reach the loaded render.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  beforeEach(() => {
    mockState.mode = 'picker';
    mockState.circles = ALL_CIRCLES;
    mockState.cap = 3;
    mockState.listFails = false;
    mockPush.mockClear();
    (captureError as jest.Mock).mockClear();
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it('renders the link above the list, not after it', async () => {
    await renderLoaded();

    expect(swallowedError()).toBe('none');
    const texts = visibleText(tree);
    expect(texts).toContain(STRINGS.addCircleLink);
    // Above the list: the link is painted before the first circle's name.
    expect(texts.indexOf(STRINGS.addCircleLink)).toBeLessThan(
      texts.indexOf(ALL_CIRCLES[0].name)
    );
    expect(texts).toContain(ALL_CIRCLES[2].name);
  });

  it('routes to circle-setup under the cap', async () => {
    mockState.circles = ALL_CIRCLES.slice(0, 2);
    await renderLoaded();

    act(() => addLink(tree)!.props.onPress());

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/onboarding/circle-setup',
      params: { fromToday: 'true' },
    });
  });

  it('routes to circle-cap AT the cap, carrying the cap itself', async () => {
    await renderLoaded();

    act(() => addLink(tree)!.props.onPress());

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/onboarding/circle-cap',
      params: { cap: '3' },
    });
  });

  it('reads the real cap, so a founder-allowlisted account is not sent to the cap screen', async () => {
    // Cat's own account: 3 circles against a cap of 10. A screen defaulting
    // to MAX_CIRCLES instead of asking app_caps() sends her to the cap
    // screen with seven circles still to spare.
    mockState.cap = 10;
    await renderLoaded();

    act(() => addLink(tree)!.props.onPress());

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/onboarding/circle-setup',
      params: { fromToday: 'true' },
    });
  });
});

/**
 * CR2 job 3 (10 Aug) — THE SAME LINK, ON THE VIEW THE COHORT ACTUALLY SEES.
 *
 * CR1 put the link on the picker above, and measured against the live cohort
 * that reached everyone except the two people the beta exists to test:
 * `resolveCircleSelection` sends anyone with exactly ONE circle straight to
 * the detail view, so Russ and Soraya — the only two accounts with one
 * circle, and the only two who are neither Cat nor family — never saw a list
 * and never saw the link.
 *
 * WHAT THIS PINS, and why it is not just "the link renders":
 *
 * 1. It renders at all on this branch, and in the TAIL — after the circle's
 *    own name, before "leave this circle". Top-of-screen on a single
 *    circle's page reads as an action ON that circle.
 * 2. THE COUNT. `listCircles` is empty by construction here, so a detail
 *    branch reusing it compares 0 against the cap and offers "start another"
 *    to somebody already full — the exact silent drift CR1's hook exists to
 *    prevent, arriving through the argument instead of through a second
 *    copy. The at-cap case below is a person in three circles who tapped
 *    into one of them, which is most of this cohort.
 * 3. THE CAP. It is `app_caps()`'s answer, not MAX_CIRCLES: this branch
 *    never called for it before, so Cat's allowlisted 10 was being read as
 *    3 and would have sent her to the cap screen with seven to spare.
 * 4. THE UNKNOWN COUNT. A failed membership read is not zero. The link is
 *    absent rather than pointed at a guessed destination.
 */
describe('the circles tab, single-circle path — "+ add a circle" (CR2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const YourCircle = require('@/app/(app)/(tabs)/circle').default as React.ComponentType;

  let tree: ReactTestRenderer;

  const renderLoaded = async () => {
    await act(async () => {
      tree = create(React.createElement(YourCircle));
    });
    // The detail branch awaits a second round INSIDE its first (the
    // per-member nudge-opt-out reads), so it needs more than one flush to
    // reach the loaded render — one more than the picker branch above.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  beforeEach(() => {
    mockState.mode = 'single';
    mockState.circles = ALL_CIRCLES.slice(0, 1);
    mockState.cap = 3;
    mockState.listFails = false;
    mockPush.mockClear();
    (captureError as jest.Mock).mockClear();
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it('renders the link on the detail view, in the tail rather than the header', async () => {
    await renderLoaded();

    expect(swallowedError()).toBe('none');
    const texts = visibleText(tree);
    // This IS the detail view, not the list: the circle's own name is the
    // title, and the leave link is the tail this screen ends on.
    expect(texts).toContain(ALL_CIRCLES[0].name);
    expect(texts).toContain(STRINGS.circleLeaveLink);
    expect(texts).toContain(STRINGS.addCircleLink);
    // Below the circle it is about, and above the way out of it.
    expect(texts.indexOf(STRINGS.addCircleLink)).toBeGreaterThan(
      texts.indexOf(ALL_CIRCLES[0].name)
    );
    expect(texts.indexOf(STRINGS.addCircleLink)).toBeLessThan(
      texts.indexOf(STRINGS.circleLeaveLink)
    );
  });

  it('routes to circle-setup under the cap — the one-circle account CR2 is for', async () => {
    await renderLoaded();

    act(() => addLink(tree)!.props.onPress());

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/onboarding/circle-setup',
      params: { fromToday: 'true' },
    });
  });

  it('routes to circle-cap AT the cap, from inside one of the three circles', async () => {
    // Three circles, cap of three, looking at the first — a count taken
    // from `listCircles` would read 0 here and offer the create flow.
    mockState.circles = ALL_CIRCLES;
    await renderLoaded();

    act(() => addLink(tree)!.props.onPress());

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/onboarding/circle-cap',
      params: { cap: '3' },
    });
  });

  it('reads the real cap here too, so the founder account is not sent to the cap screen', async () => {
    mockState.circles = ALL_CIRCLES;
    mockState.cap = 10;
    await renderLoaded();

    act(() => addLink(tree)!.props.onPress());

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/onboarding/circle-setup',
      params: { fromToday: 'true' },
    });
  });

  it('offers nothing when the membership read failed, rather than guessing a destination', async () => {
    mockState.listFails = true;
    await renderLoaded();

    expect(swallowedError()).toBe('none');
    // The screen is still here — the failure is scoped to the count.
    expect(visibleText(tree)).toContain(ALL_CIRCLES[0].name);
    expect(addLink(tree)).toBeUndefined();
  });
});
