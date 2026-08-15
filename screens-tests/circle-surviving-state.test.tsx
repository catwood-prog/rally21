/**
 * LV2 jobs 5 + 6 (15 Aug) — THE THREE REMAINING WRONG-CIRCLE WRITE PATHS,
 * AND THE FAILED LEAVE THAT USED TO TAKE THE SCREEN WITH IT.
 *
 * LV1 fixed one inherited confirm card. Its report-only sweep found the
 * class is four instances deep in this one file: `load()` resets a
 * handful of values and the detail path reassigns fifteen more, so
 * twenty-one survive nothing. The staleness stayed invisible because
 * `isLoading` gates the whole screen — one guard doing all the work, and
 * it stops working the moment a value OUTLIVES the load rather than
 * racing it.
 *
 * WHY EACH TEST PRESSES THE BUTTON INSTEAD OF ASSERTING THE CARD IS GONE.
 * "No card is rendered" is the symptom; the defect is that the control on
 * screen acts on `circle.id` — whatever circle is loaded NOW — while the
 * card was opened on a different one. So each test switches circles and
 * then, if the inherited control is still there, presses it and asserts
 * the write never reached the second circle. Against HEAD the control is
 * found, pressed, and the wrong-circle write happens; after the fix there
 * is nothing to press. The assertion names the real consequence either
 * way.
 *
 * JOB 1 IS THE SERIOUS ONE and it is not the leave. `isConfirmingComplete`
 * ends the circle FOR EVERY MEMBER, the card names one circle while the
 * button completes the one on screen, and unlike leave nothing accidental
 * protects it: `handleCompleteCircle` already clears `isCompleting` in a
 * `finally`, so the button is live rather than frozen behind a spinner.
 * LV1's stuck spinner was the only reason its own bug was survivable.
 *
 * THE FIXTURE IS THE REACHABLE CASE, not a contrived one. Both circles
 * are created by the signed-in account and both are public, because that
 * is what `isCreator` and `circle.isPublic` gate the host controls on —
 * and three real accounts have created two or more active circles.
 *
 * WHY THIS FILE IS NOT CO-LOCATED (BG1): `app/` IS the router, so a
 * co-located test would put a sixth pill on the live tab bar. Screen tests
 * reach the screen through the require below, with the REAL error boundary
 * left on so a crash cannot pass as a render (`swallowedError()`).
 */
import React from 'react';
import { Text, TextInput, TouchableOpacity } from 'react-native';
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
  // Mine, and public: `isCreator` gates the host-controls card, and
  // `circle.isPublic` gates member management inside it. This is the
  // account shape the three write paths are actually reachable from.
  createdBy: ME,
  resourceUrl: null,
  instructions: null,
  isPublic: true,
  closedToJoins: false,
  ralliedOnAt: null,
  completedAt: null,
  myJoinSource: 'creator',
  wallSeenAt: null,
  myFinishedAt: null,
});

const ABS = circle('11111111-1111-4111-8111-111111111111', 'Abs workout');
const YOGA = circle('22222222-2222-4222-8222-222222222222', 'Stretching Yoga moves');

const member = (userId: string, name: string) => ({
  userId,
  name,
  avatarUrl: null,
  role: userId === ME ? 'owner' : 'member',
  birthMonth: null,
  birthDay: null,
  celebrateBirthday: true,
  timezone: 'Europe/London',
  joinedAt: '2026-07-25T09:00:00.000Z',
  awaySince: null,
  finishedAt: null,
});

/** Mutated per test; the mock factories read it at CALL time. `params` is
 * what drives a RE-LOAD — `load` is keyed on `[session.user.id, circleId]`,
 * so changing the circleId is what focusing a different circle looks like
 * from this screen's point of view. */
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
/** The three writes under test. Each takes a circle id as its FIRST
 * argument, which is the whole point: the id comes from whatever circle
 * is loaded now, never from the circle the control was opened on. */
const mockCompleteCircle = jest.fn(async (_circleId: string) => {});
const mockSetCircleResourceUrl = jest.fn(async (_circleId: string, _url: string | null) => {});
const mockRemoveMemberFromCircle = jest.fn(async (_circleId: string, _memberId: string) => {});

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
  resolveCircleSelection: jest.fn(async () => ({
    kind: 'single' as const,
    circle: mockState.detail,
  })),
  listMyCircles: jest.fn(async () => mockState.remaining),
  leaveCircle: (...args: [string]) => mockLeaveCircle(...args),
  setCircleResourceUrl: (...args: [string, string | null]) => mockSetCircleResourceUrl(...args),
  removeMemberFromCircle: (...args: [string, string]) => mockRemoveMemberFromCircle(...args),
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
  // 0, never null: null is "the marker has not loaded" and the ceremony
  // effect deliberately parks on it.
  getMyLastCelebratedDay: jest.fn(async () => 0),
  completeCircle: (...args: [string]) => mockCompleteCircle(...args),
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

function visibleText(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((c): c is string => typeof c === 'string');
}

function swallowedError(): string {
  const calls = (captureError as jest.Mock).mock.calls.filter(
    ([, tags]) => tags && 'boundary' in tags
  );
  if (calls.length === 0) return 'none';
  return calls.map(([e]) => (e instanceof Error ? e.message : String(e))).join(' | ');
}

/** A tappable whose own label is exactly `label`. */
function tappable(tree: ReactTestRenderer, label: string) {
  return tree.root
    .findAllByType(TouchableOpacity)
    .find((t) => t.findAllByType(Text).some((x) => x.props.children === label));
}

/** The card holding a given sentence, found by that sentence. */
function cardWith(tree: ReactTestRenderer, sentence: string): ReactTestInstance | null {
  const body = tree.root.findAllByType(Text).find((t) => t.props.children === sentence);
  return body ? body.parent : null;
}

describe('the circle tab — no state describes the previous circle (LV2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const YourCircle = require('@/app/(app)/(tabs)/circle').default as React.ComponentType;

  let tree: ReactTestRenderer;

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

  /** Focusing a DIFFERENT circle: the param changes, `load` is re-created,
   * the focus effect runs it again — and the tab is never unmounted, which
   * is the condition every bug in this file depends on. */
  const focusCircle = async (c: typeof ABS) => {
    mockState.detail = c;
    mockState.params = { circleId: c.id };
    await act(async () => {
      tree.update(React.createElement(YourCircle));
    });
    await settle();
  };

  const press = (label: string) => act(() => tappable(tree, label)!.props.onPress());

  beforeEach(() => {
    mockState.detail = ABS;
    mockState.remaining = [ABS, YOGA];
    // Bare, so every focusCircle below is a real change to load's key.
    mockState.params = {};
    mockState.leaveFails = false;
    mockReplace.mockClear();
    mockLeaveCircle.mockClear();
    mockCompleteCircle.mockClear();
    mockSetCircleResourceUrl.mockClear();
    mockRemoveMemberFromCircle.mockClear();
    (captureError as jest.Mock).mockClear();
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it('CONTROL — all three controls open on the circle they belong to', async () => {
    // Without this the three absence tests below could pass by never
    // finding a control at all. Passes on both sides of the fix.
    await renderLoaded();
    expect(swallowedError()).toBe('none');

    press(STRINGS.journeyCompleteHostControlLabel);
    expect(cardWith(tree, STRINGS.journeyCompleteConfirmTitle(ABS.name))).not.toBeNull();

    press(STRINGS.circleAddLinkPrompt);
    expect(tree.root.findAllByType(TextInput).length).toBeGreaterThan(0);

    press(STRINGS.circleManageMembersLink);
    press(STRINGS.removeCta);
    expect(visibleText(tree)).toContain(STRINGS.hostRemoveMemberConfirm('Russ'));
  });

  it('JOB 1 — a complete-circle confirm card never ends a circle it was not opened on', async () => {
    await renderLoaded();
    press(STRINGS.journeyCompleteHostControlLabel);
    expect(cardWith(tree, STRINGS.journeyCompleteConfirmTitle(ABS.name))).not.toBeNull();

    await focusCircle(YOGA);
    expect(swallowedError()).toBe('none');
    expect(visibleText(tree)).toContain(YOGA.name);

    // AGAINST HEAD: the card is still here, now titled with YOGA's name,
    // its button live because `isCompleting` was already cleared.
    expect(cardWith(tree, STRINGS.journeyCompleteConfirmTitle(YOGA.name))).toBeNull();
    expect(cardWith(tree, STRINGS.journeyCompleteConfirmTitle(ABS.name))).toBeNull();

    // And the consequence, which is the point: press it if it is there.
    const inherited = tappable(tree, STRINGS.journeyGateCompleteCta);
    if (inherited) {
      await act(async () => {
        inherited.props.onPress();
      });
      await settle();
    }
    expect(mockCompleteCircle).not.toHaveBeenCalled();
  });

  it('JOB 2 — a link editor never writes the previous circle’s draft onto this one', async () => {
    await renderLoaded();
    press(STRINGS.circleAddLinkPrompt);
    const input = tree.root.findAllByType(TextInput)[0];
    act(() => input.props.onChangeText('https://abs-workout.example/routine'));

    await focusCircle(YOGA);
    expect(swallowedError()).toBe('none');

    // AGAINST HEAD: the editor is still open — and note it is not even
    // gated on `isCreator` on this branch, only its else-branch is — still
    // holding the URL typed for the other circle.
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);

    const save = tappable(tree, STRINGS.saveCta);
    if (save) {
      await act(async () => {
        save.props.onPress();
      });
      await settle();
    }
    expect(mockSetCircleResourceUrl).not.toHaveBeenCalled();
  });

  it('JOB 3 — a member-removal confirm never removes them from the wrong circle', async () => {
    // Russ is in BOTH circles, which is exactly the condition this one
    // needs: the row self-guards on `members.some(...)`, so it survives
    // only for somebody who is a member of the circle you land on.
    await renderLoaded();
    press(STRINGS.circleManageMembersLink);
    press(STRINGS.removeCta);
    expect(visibleText(tree)).toContain(STRINGS.hostRemoveMemberConfirm('Russ'));

    await focusCircle(YOGA);
    expect(swallowedError()).toBe('none');

    expect(visibleText(tree)).not.toContain(STRINGS.hostRemoveMemberConfirm('Russ'));

    const remove = tappable(tree, STRINGS.hostRemoveMemberCta);
    if (remove) {
      await act(async () => {
        remove.props.onPress();
      });
      await settle();
    }
    expect(mockRemoveMemberFromCircle).not.toHaveBeenCalled();
  });

  it('JOB 5 — a failed leave says so INSIDE the card, and the circle screen is still standing', async () => {
    mockState.leaveFails = true;
    await renderLoaded();
    press(STRINGS.circleLeaveLink);

    const card = cardWith(tree, STRINGS.circleLeaveConfirmBody(ABS.name))!;
    await act(async () => {
      card.findAllByType(TouchableOpacity)[1].props.onPress();
    });
    await settle();

    const texts = visibleText(tree);
    // The message is there either way — the difference is everything
    // around it. AGAINST HEAD `error` drives the early return and the
    // whole screen is replaced by an ErrorSlip, so the circle is gone.
    expect(texts).toContain('could not leave — try again');
    expect(texts).toContain(ABS.name);
    expect(texts).toContain(STRINGS.circleLeaveConfirmBody(ABS.name));
    // Still offering the retry, rather than a dead end.
    expect(texts).toContain(STRINGS.circleLeaveConfirmCta);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('JOB 5 — the failed leave’s message does not follow you to the next circle', async () => {
    mockState.leaveFails = true;
    await renderLoaded();
    press(STRINGS.circleLeaveLink);
    const card = cardWith(tree, STRINGS.circleLeaveConfirmBody(ABS.name))!;
    await act(async () => {
      card.findAllByType(TouchableOpacity)[1].props.onPress();
    });
    await settle();
    expect(visibleText(tree)).toContain('could not leave — try again');

    mockState.leaveFails = false;
    await focusCircle(YOGA);

    expect(visibleText(tree)).not.toContain('could not leave — try again');
    expect(visibleText(tree)).toContain(YOGA.name);
  });
});
