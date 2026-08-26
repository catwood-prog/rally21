/**
 * AE1 job 4 (26 Aug) — AN ACTION THAT FAILS MUST NOT TAKE THE SCREEN AWAY,
 * AND THE DIALOG THAT WAS ALWAYS THERE TO SAY SO MUST FINALLY RENDER.
 *
 * THE DEFECT, in one line: six catches wrote an ACTION failure into
 * `error`, and `error` is what the early return at the top of the render
 * reads to decide the screen cannot be shown. Toggle a circle closed to
 * joins and have the write fail, and the entire circle — huddle, wall
 * preview, host controls, everything — is replaced by an apology slip. The
 * `<MessageDialog visible={!!error} title="hmm">` that was supposed to say
 * it sits BELOW that early return and so had never rendered once in the
 * app's life.
 *
 * WHY THE ASSERTION IS "THE CIRCLE IS STILL ON SCREEN" AND NOT "THE MESSAGE
 * IS SHOWN". Against HEAD the message IS shown — ErrorSlip prints the same
 * sentence. Asserting the sentence would be vacuously green on both sides,
 * the hollow-fixture class CV2 found seven of. The thing that actually
 * changes is whether the screen survives the failure, so that is what each
 * test names, and the dialog is asserted as a COMPONENT (visible, carrying
 * the message) rather than as a string.
 *
 * WHY A JEST SCREEN TEST AND NOT LV2's playwright page.route. The section
 * names page.route as the technique for forcing a 500. Here the failing
 * surface is a client handler's catch, so the equivalent force is the
 * mocked write rejecting — same forced failure, one process, no dev server,
 * and deterministic. The discriminator is identical either way.
 *
 * WHY THIS FILE IS NOT CO-LOCATED (BG1): `app/` IS the router, so a
 * co-located test would put a sixth pill on the live tab bar. Screen tests
 * reach the screen through the require below, with the REAL error boundary
 * left on so a crash cannot pass as a render (`swallowedError()`).
 */
import React from 'react';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { MessageDialog } from '@/components/MessageDialog';
import { STRINGS } from '@/constants/strings';
import { captureError } from '@/lib/sentry';

const ME = 'c0a80a1e-0000-4000-8000-000000000001';
const MATE = 'c0a80a1e-0000-4000-8000-000000000002';
const TODAY = '2026-08-15';

/** Mine and public: `isCreator` gates the host-controls card and
 * `circle.isPublic` gates the closed-to-joins toggle inside it, which is
 * the action this file forces to fail. */
const ABS = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Abs workout',
  timeOfDay: null,
  startDate: '2026-07-25',
  durationDays: 21,
  practiceName: 'Abs workout',
  practiceIsUserCreated: false,
  durationMinutes: 10,
  inviteCode: 'AAAAAA',
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
};

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

/** Mutated per test; every mock factory reads it at CALL time.
 * `signedIn` drives job 4c — see the comment on that test for why the
 * session, and not the circle, is what flips `isCreator`. */
const mockState = {
  toggleFails: false,
  loadFails: false,
  signedIn: true as boolean,
};

const mockSetCircleClosedToJoins = jest.fn(async (_circleId: string, _closed: boolean) => {
  if (mockState.toggleFails) throw new Error('nope');
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() }),
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

jest.mock('react-native-webview', () => ({ WebView: () => null }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    session: mockState.signedIn
      ? { user: { id: 'c0a80a1e-0000-4000-8000-000000000001' } }
      : null,
  }),
}));

jest.mock('@/lib/date', () => ({
  ...jest.requireActual('@/lib/date'),
  getLocalDateString: () => '2026-08-15',
}));

jest.mock('@/lib/circle', () => ({
  ...jest.requireActual('@/lib/circle'),
  resolveCircleSelection: jest.fn(async () => ({ kind: 'single' as const, circle: ABS })),
  listMyCircles: jest.fn(async () => [ABS]),
  setCircleClosedToJoins: (...args: [string, boolean]) => mockSetCircleClosedToJoins(...args),
  getCircleMembers: jest.fn(async () => {
    // The LOAD failure of job 4b. getCircleMembers is inside load()'s own
    // try, so this is a real load path failure, not a synthesised one.
    if (mockState.loadFails) throw new Error('members read failed');
    return [member(ME, 'Cat'), member(MATE, 'Russ')];
  }),
  getCirclePresence: jest.fn(async () => [
    { userId: MATE, localDate: TODAY, kind: 'self', coveredBy: null, createdAt: `${TODAY}T09:00:00.000Z` },
  ]),
  getCoverableMembers: jest.fn(async () => new Map<string, string>()),
  isHostHandoverNotePending: jest.fn(async () => false),
  markHostHandoverNoteSeen: jest.fn(async () => {}),
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
  getMyLastCelebratedDay: jest.fn(async () => 0),
  completeCircle: jest.fn(async () => {}),
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

/** Every MessageDialog on the screen that is actually open. */
function openDialogs(tree: ReactTestRenderer) {
  return tree.root.findAllByType(MessageDialog).filter((d) => d.props.visible);
}

function tappable(tree: ReactTestRenderer, label: string) {
  return tree.root
    .findAllByType(TouchableOpacity)
    .find((t) => t.findAllByType(Text).some((x) => x.props.children === label));
}

describe('the circle tab — an action failure never replaces the screen (AE1)', () => {
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

  beforeEach(() => {
    mockState.toggleFails = false;
    mockState.loadFails = false;
    mockState.signedIn = true;
    mockSetCircleClosedToJoins.mockClear();
    (captureError as jest.Mock).mockClear();
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it('4a — a failed host action leaves the circle standing and speaks through the dialog', async () => {
    mockState.toggleFails = true;
    await renderLoaded();
    expect(swallowedError()).toBe('none');
    // The control is really there before it is pressed, so a later
    // "no failure happened" can never be a missing button.
    expect(visibleText(tree)).toContain(ABS.name);
    expect(tappable(tree, STRINGS.hostCloseToJoinsLabel)).toBeDefined();

    await act(async () => {
      tappable(tree, STRINGS.hostCloseToJoinsLabel)!.props.onPress();
    });
    await settle();

    // AGAINST HEAD: `error` is now set, the early return fires, and the
    // whole circle is gone — replaced by an ErrorSlip. Both assertions
    // below fail there, and they are the two halves of the same claim.
    expect(mockSetCircleClosedToJoins).toHaveBeenCalledWith(ABS.id, true);
    expect(visibleText(tree)).toContain(ABS.name);

    const dialogs = openDialogs(tree);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].props.title).toBe('hmm');
    expect(dialogs[0].props.message).toBe('nope');

    // And it is dismissible — the dialog owns clearing its own state, so a
    // failure cannot become a permanent fixture of the screen.
    await act(async () => {
      dialogs[0].props.onDismiss();
    });
    expect(openDialogs(tree)).toHaveLength(0);
    expect(visibleText(tree)).toContain(ABS.name);
  });

  it('4b — CONTROL: a failed LOAD still takes the screen, exactly as before', async () => {
    // The negative control, and the reason 4a is not simply "the early
    // return was weakened". `error` keeps its whole meaning — this screen
    // cannot be shown — and this test is GREEN ON BOTH SIDES of the fix,
    // which is the only way it can catch the over-correction.
    mockState.loadFails = true;
    await renderLoaded();
    expect(swallowedError()).toBe('none');

    expect(visibleText(tree)).toContain(STRINGS.loadFailedLine('your circle'));
    expect(visibleText(tree)).not.toContain(ABS.name);
    expect(openDialogs(tree)).toHaveLength(0);
  });

  it('4c — an open link editor does not render for someone who is not the creator', async () => {
    // FORCING THE STATE, and why this route is the honest one. `isCreator`
    // is `circle.createdBy === session?.user?.id`, and LV2 closed every
    // path where the CIRCLE changes under an open editor —
    // closeStateForPreviousCircle shuts it on the way into every load. The
    // one seam left is the other operand: `load()` returns at
    // `if (!session?.user)` BEFORE it reaches that reset, so a session that
    // goes away mid-visit (an expiry, a refresh that comes back null)
    // leaves the editor open and flips `isCreator` false in the same
    // render. That is the future state leak Cat's ruling is belt-and-braces
    // against, reached without touching a guard.
    await renderLoaded();
    await act(async () => {
      tappable(tree, STRINGS.circleAddLinkPrompt)!.props.onPress();
    });
    expect(tree.root.findAllByType(TextInput).length).toBeGreaterThan(0);

    mockState.signedIn = false;
    await act(async () => {
      tree.update(React.createElement(YourCircle));
    });
    await settle();

    // The circle is still on screen — this is a session gap, not a load
    // failure — so the editor's absence is a real absence and not the
    // whole screen having gone.
    expect(swallowedError()).toBe('none');
    expect(visibleText(tree)).toContain(ABS.name);
    // AGAINST HEAD: the editor branch reads `isEditingLink` alone, so the
    // input is still here, offered to someone the server will refuse.
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
    expect(visibleText(tree)).not.toContain(STRINGS.saveCta);
  });
});
