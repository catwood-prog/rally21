/**
 * LV1 job 3 (15 Aug) — THE LEAVE CONFIRM CARD'S STATE, ACROSS A CIRCLE
 * SWITCH.
 *
 * WHAT THIS PINS, and why it is the STATE rather than the button. The leave
 * flow itself worked: at 15:06:35 UTC on 15 Aug the RPC returned 204, the
 * membership re-read returned 200, and `router.replace` fired. There is no
 * second `leave_circle` request anywhere in the logs, which is what rules
 * out a hung call. What was wrong was everything the screen was still
 * holding afterwards.
 *
 * `isLeaving` was cleared ONLY in `handleLeave`'s catch, and the circle tab
 * does NOT unmount on `router.replace` — so a SUCCESSFUL leave left the
 * spinner spinning forever. `isConfirmingLeave` was never cleared by
 * anything at all, and `load()` — which already resets the CB1 marker and
 * the CR2 count on every focus, for exactly this reason — did not reset
 * either of them. Both therefore survived the navigation AND the switch to
 * a different circle.
 *
 * SO THE SECOND TEST IS THE SERIOUS ONE, and it is not the reported
 * symptom. A confirm card opened on circle A, then carried onto circle B,
 * re-renders `circleLeaveConfirmBody(circle.name)` with B's name over a
 * live destructive button. Cat saw it behind a stuck spinner, which meant
 * `disabled={isLeaving}` was swallowing every tap — the bug that looks like
 * the defect was the only thing preventing a wrong-circle leave. Arm the
 * card WITHOUT leaving (test 2) and the spinner is not there to save you.
 *
 * THE CLASS IS THIS SCREEN'S RECURRING ONE: state describing the PREVIOUS
 * circle surviving into a decision about the NEXT one. CB1's stale zero
 * routed a ceremony, CR2's empty count routed an at-cap screen, and this
 * one arms a destructive action.
 *
 * WHY THIS FILE IS NOT CO-LOCATED (BG1): `app/` IS the router, so a
 * co-located `circle.test.tsx` would put a sixth pill on the live floating
 * tab bar. Screen tests reach the screen through the require below.
 *
 * WHY THE ERROR BOUNDARY STAYS ON: the export under test is the boundaried
 * one the tab actually renders, so a crash lands on the recovery screen
 * instead of throwing out of `create()`, and every "did it render?"
 * assertion would pass a broken screen. `swallowedError()` is the guard.
 */
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { act, create, ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import { STRINGS } from '@/constants/strings';
import { captureError } from '@/lib/sentry';

const ME = 'c0a80a1e-0000-4000-8000-000000000001';
const MATE = 'c0a80a1e-0000-4000-8000-000000000002';
const TODAY = '2026-08-15';

const circle = (id: string, name: string) => ({
  id,
  name,
  timeOfDay: null,
  startDate: '2026-07-25',
  durationDays: 21,
  practiceName: name,
  practiceIsUserCreated: false,
  durationMinutes: 10,
  inviteCode: 'AAAAAA',
  // NOT me: the leave link is ungated, but the host controls are not, and
  // a creator-owned fixture would drag the complete-circle confirm card
  // (its own `cancelCta`) into the tree and blunt the anchors below.
  createdBy: MATE,
  resourceUrl: null,
  instructions: null,
  isPublic: false,
  closedToJoins: false,
  ralliedOnAt: null,
  completedAt: null,
  myJoinSource: 'invite',
  wallSeenAt: null,
  myFinishedAt: null,
});

/** The two circles from the real report: she left the first and was then
 * looking at a card armed at the second. */
const ABS = circle('11111111-1111-4111-8111-111111111111', 'Abs workout');
const YOGA = circle('22222222-2222-4222-8222-222222222222', 'Stretching/Yoga moves');

const member = (userId: string, name: string) => ({
  userId,
  name,
  avatarUrl: null,
  role: userId === MATE ? 'owner' : 'member',
  birthMonth: null,
  birthDay: null,
  celebrateBirthday: true,
  timezone: 'Europe/London',
  joinedAt: '2026-07-25T09:00:00.000Z',
  awaySince: null,
  finishedAt: null,
});

/** Mutated per test; every mock factory below reads it at CALL time.
 *
 * `detail` is what `resolveCircleSelection` lands the screen on — the
 * single-circle branch, which is the one carrying the leave link. `params`
 * is what drives a RE-LOAD: `load` is keyed on `[session.user.id,
 * circleId]`, so changing the circleId is what a real focus on a different
 * circle looks like from this screen's point of view. `remaining` is what
 * `listMyCircles` hands `handleLeave` to choose its destination with. */
const mockState = {
  detail: ABS,
  remaining: [ABS, YOGA],
  params: {} as { circleId?: string },
  leaveFails: false,
};

const mockReplace = jest.fn();
const mockLeaveCircle = jest.fn(async (_circleId: string) => {
  if (mockState.leaveFails) throw new Error('could not leave — try again');
});

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: mockReplace,
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
  useLocalSearchParams: () => mockState.params,
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
  getLocalDateString: () => '2026-08-15',
}));

jest.mock('@/lib/circle', () => ({
  ...jest.requireActual('@/lib/circle'),
  // Mocked at the RESOLVER, not at listMyCircles: resolveCircleSelection
  // takes its two lookups as a defaulted `deps` argument bound inside the
  // real module, so replacing the module's exported listMyCircles would
  // leave the resolver still calling the real one.
  resolveCircleSelection: jest.fn(async () => ({
    kind: 'single' as const,
    circle: mockState.detail,
  })),
  listMyCircles: jest.fn(async () => mockState.remaining),
  leaveCircle: (...args: [string]) => mockLeaveCircle(...args),
  getCircleMembers: jest.fn(async () => [member(ME, 'Cat'), member(MATE, 'Russ')]),
  getCirclePresence: jest.fn(async () => [
    { userId: MATE, localDate: TODAY, kind: 'self', coveredBy: null, createdAt: `${TODAY}T09:00:00.000Z` },
  ]),
  getCoverableMembers: jest.fn(async () => new Map<string, string>()),
  subscribeToCirclePresence: jest.fn(() => () => {}),
}));

jest.mock('@/lib/caps', () => ({
  ...jest.requireActual('@/lib/caps'),
  getMyCircleCap: jest.fn(async () => 3),
}));

// The rest of the detail branch's load batch. None of it is what this test
// is about; all of it has to resolve or the screen never reaches its loaded
// render. Every value is the QUIET one, so nothing but the screen's own
// furniture and the leave flow is on the page.
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
  // rendered but the effect permanently parked.
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

/** The quiet "leave this circle" link — the card's CLOSED state. */
function leaveLink(tree: ReactTestRenderer) {
  return tree.root
    .findAllByType(TouchableOpacity)
    .find((t) => t.findAllByType(Text).some((x) => x.props.children === STRINGS.circleLeaveLink));
}

/** The confirm card, anchored on the body sentence — which NAMES a circle,
 * so asking for it by name is the whole point: a card armed at the wrong
 * circle is found by asking for the wrong circle's card and getting one. */
function leaveCard(tree: ReactTestRenderer, circleName: string): ReactTestInstance | null {
  const body = tree.root
    .findAllByType(Text)
    .find((t) => t.props.children === STRINGS.circleLeaveConfirmBody(circleName));
  return body ? body.parent : null;
}

/** The destructive button inside a confirm card: cancel is first in the
 * row, the leave action second. */
function destructiveButton(card: ReactTestInstance) {
  return card.findAllByType(TouchableOpacity)[1];
}

describe('the circle tab — the leave flow leaves no state behind (LV1)', () => {
  // Required inside the describe, never imported at module scope: jest
  // hoists the mock factories above ES imports, so a top-level import
  // evaluates them while the fixtures above are still in TDZ.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const YourCircle = require('@/app/(app)/(tabs)/circle').default as React.ComponentType;

  let tree: ReactTestRenderer;

  /** The detail branch awaits a second round INSIDE its first (the
   * per-member nudge-opt-out reads), so it needs more than one flush to
   * reach the loaded render. */
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  const renderLoaded = async () => {
    await act(async () => {
      tree = create(React.createElement(YourCircle));
    });
    await settle();
  };

  /** What a real focus on a DIFFERENT circle does to this screen: the
   * circleId param changes, `load` is re-created, and the focus effect
   * runs it again. The tab is never unmounted — that is the whole bug. */
  const focusCircle = async (c: typeof ABS) => {
    mockState.detail = c;
    mockState.params = { circleId: c.id };
    await act(async () => {
      tree.update(React.createElement(YourCircle));
    });
    await settle();
  };

  const armTheCard = () => {
    act(() => leaveLink(tree)!.props.onPress());
  };

  beforeEach(() => {
    mockState.detail = ABS;
    mockState.remaining = [ABS, YOGA];
    // Deliberately BARE: the first load is the tab's own (no circleId
    // param), so every `focusCircle` below is a real change to `load`'s
    // dependency and therefore a real re-run of the focus effect.
    mockState.params = {};
    mockState.leaveFails = false;
    mockReplace.mockClear();
    mockLeaveCircle.mockClear();
    (captureError as jest.Mock).mockClear();
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it('renders the card armed at the circle it was opened on, and nothing else', async () => {
    // The control: without this, the two failing tests below could pass by
    // never finding a card at all.
    await renderLoaded();
    expect(swallowedError()).toBe('none');
    expect(leaveCard(tree, ABS.name)).toBeNull();

    armTheCard();

    expect(leaveCard(tree, ABS.name)).not.toBeNull();
    expect(leaveCard(tree, YOGA.name)).toBeNull();
    expect(visibleText(tree)).toContain(STRINGS.circleLeaveConfirmCta);
  });

  it('JOB 1 — a SUCCESSFUL leave stops the spinner, rather than freezing the button forever', async () => {
    await renderLoaded();
    armTheCard();

    await act(async () => {
      destructiveButton(leaveCard(tree, ABS.name)!).props.onPress();
    });
    await settle();

    // The leave really did succeed — this is the 204 + 200 + replace from
    // the logs, and it is why a hung request is not the explanation.
    expect(mockLeaveCircle).toHaveBeenCalledTimes(1);
    expect(mockLeaveCircle).toHaveBeenCalledWith(ABS.id);
    expect(mockReplace).toHaveBeenCalledWith('/today');

    // AGAINST HEAD THIS IS THE FAILURE: the success path returned without
    // clearing `isLeaving`, so the card behind the navigation kept its
    // spinner and `disabled={isLeaving}` kept swallowing every tap.
    const card = leaveCard(tree, ABS.name)!;
    expect(card.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(destructiveButton(card).props.disabled).toBe(false);
  });

  it('JOB 1 — a FAILED leave still says so, and the screen recovers on the next focus', async () => {
    // The path that always worked, pinned so the move from a clear inside
    // the catch to a clear inside `finally` cannot quietly lose it.
    //
    // WHY THIS DOES NOT ASSERT ON THE CARD, and it is a finding rather
    // than a limitation of the test: `handleLeave`'s catch calls
    // `setError`, and `error` REPLACES THE WHOLE SCREEN (:692) with an
    // ErrorSlip — so on this path there is no card, no button and no
    // spinner left to look at. The flag's state is genuinely unobservable
    // here. That screen-replacement is reported under job 4 and NOT
    // changed: it is a behaviour decision outside this section's fence.
    mockState.leaveFails = true;
    await renderLoaded();
    armTheCard();

    await act(async () => {
      destructiveButton(leaveCard(tree, ABS.name)!).props.onPress();
    });
    await settle();

    expect(mockReplace).not.toHaveBeenCalled();
    expect(visibleText(tree)).toContain('could not leave — try again');

    // The recovery: the next focus clears `error` and — LV1 job 2 — the
    // two leave flags with it, so she is not returned to an armed card.
    mockState.leaveFails = false;
    await focusCircle(ABS);
    expect(visibleText(tree)).not.toContain('could not leave — try again');
    expect(leaveCard(tree, ABS.name)).toBeNull();
    expect(leaveLink(tree)).toBeDefined();
  });

  it('JOB 2 — a card armed on one circle is NOT inherited by the next one', async () => {
    // The serious half, and note there is no leave in it at all: the card
    // is merely OPEN when the person moves to another circle. `isLeaving`
    // is false throughout, so the destructive button here is not even
    // behind the spinner that accidentally protected Cat.
    await renderLoaded();
    armTheCard();
    expect(leaveCard(tree, ABS.name)).not.toBeNull();

    await focusCircle(YOGA);

    expect(swallowedError()).toBe('none');
    // We are genuinely looking at the other circle now.
    expect(visibleText(tree)).toContain(YOGA.name);
    // AGAINST HEAD THIS IS THE FAILURE: the inherited card re-rendered
    // with `circle.name`, so it read "Leave Stretching/Yoga moves?" on a
    // circle nobody had asked to leave.
    expect(leaveCard(tree, YOGA.name)).toBeNull();
    expect(leaveCard(tree, ABS.name)).toBeNull();
    expect(visibleText(tree)).not.toContain(STRINGS.circleLeaveConfirmCta);
    // Closed, not merely absent: the quiet link is back.
    expect(leaveLink(tree)).toBeDefined();
  });

  it('JOB 2 — the walk Cat actually took: leave one circle, come back to the tab', async () => {
    await renderLoaded();
    armTheCard();

    await act(async () => {
      destructiveButton(leaveCard(tree, ABS.name)!).props.onPress();
    });
    await settle();
    expect(mockReplace).toHaveBeenCalledWith('/today');

    // She left "Abs workout", so the tab now resolves to the other one.
    mockState.remaining = [YOGA];
    await focusCircle(YOGA);

    expect(swallowedError()).toBe('none');
    expect(visibleText(tree)).toContain(YOGA.name);
    expect(leaveCard(tree, YOGA.name)).toBeNull();
    expect(leaveCard(tree, ABS.name)).toBeNull();
    // No confirm card AND no spinner — the two halves of the report.
    expect(visibleText(tree)).not.toContain(STRINGS.circleLeaveConfirmCta);
    expect(leaveLink(tree)).toBeDefined();
    expect(leaveLink(tree)!.findAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it('JOB 3 — the destructive button is only ever rendered against the circle it was opened on', async () => {
    // Stated as the invariant rather than as a scenario: wherever a leave
    // confirm body appears, it names the circle currently on screen AND
    // the card was opened there. Walked across a switch in each direction.
    await renderLoaded();
    armTheCard();
    expect(destructiveButton(leaveCard(tree, ABS.name)!)).toBeDefined();

    await focusCircle(YOGA);
    expect(leaveCard(tree, YOGA.name)).toBeNull();

    // ...and opening it here arms THIS circle, not the one before.
    armTheCard();
    expect(leaveCard(tree, YOGA.name)).not.toBeNull();
    expect(leaveCard(tree, ABS.name)).toBeNull();

    await focusCircle(ABS);
    expect(leaveCard(tree, ABS.name)).toBeNull();
    expect(leaveCard(tree, YOGA.name)).toBeNull();
  });
});
