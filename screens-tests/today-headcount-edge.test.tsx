/**
 * HC1 (16 Aug) — TODAY'S STRIP MUST SHOW WHAT ITS SENTENCE COUNTS.
 *
 * WHAT CAT SAW, 17:12 on 16 August, two cards on one phone. "Stretching/
 * Yoga moves" read "2 of 3 in today" over FOUR avatars; "Read before bed"
 * read "that's everyone in today 🔥" with Alex Stewart shown and UNTICKED.
 * Both numbers were correct: RS1/RS2/PA2 exclude resting, away and
 * finished members from the headcount, and AU1 gave the numerator the same
 * rule. What no version of this screen ever did was SHOW the exclusion —
 * RS1 scoped its fade to the circle screen, so on Today an excluded member
 * was drawn at full strength with an ordinary pending ring, identical to an
 * active member who simply hadn't checked in yet.
 *
 * CAT'S TWO RULINGS, 16 Aug. (1) The denominator is kept exactly as it is;
 * the fix is visibility, so Today's two strips adopt RS1's own treatment.
 * (2) The two all-in 🔥 branches gain a rendered-ticked guard: no
 * celebration while any member the card represents is unticked.
 *
 * THE DATA IS THE LIVE DATA, read from `memberships` and `completions`
 * during job 1 — the same four members of `da4766c3` the BG1 harness uses,
 * with their real completion dates, on the real date. Catherine's last day
 * was 22 July, which is why she is the one at the edge.
 *
 * NOT CO-LOCATED for the reason BG1's header gives at length: anything
 * inside `app/(app)/(tabs)/` becomes a live tab.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import { Avatar } from '@/components/Avatar';
import type { MyCircle } from '@/lib/circle';
import { captureError } from '@/lib/sentry';

const RUSS = '8174d14d-01d4-4371-8b3e-c0647ce2f23f';
const CATHERINE_S = '75ec0d88-27de-4227-ab62-3d049b369960';
const CATHERINE = 'a9203f91-dd8f-46b4-861e-cfca19cb1b31';
const CATHY_S = 'decc56b0-a748-448c-a469-2b0ac6957163';
const CIRCLE = 'da4766c3-5f88-441e-b834-1a25912a8e52';
const TODAY = '2026-08-16';

const mockProfile = {
  id: RUSS,
  name: 'Russ',
  avatar_url: null,
  timezone: 'America/Los_Angeles',
  has_seen_checkin_consent: true,
  last_reentry_ack_date: null,
  birth_month: 3,
  birth_day: 20,
  celebrate_birthday: true,
  reminders_ask_seen_at: '2026-07-14T04:30:07.084Z',
  photo_ask_seen_at: '2026-07-24T05:25:29.213Z',
  warmth_seen_at: '2026-07-28T01:34:36.658Z',
  onboarding_desired_change: null,
  reflections_opt_out: false,
  keep_going_obstacle: null,
  alarm_enabled: false,
  alarm_time: null,
};

// GR1 (27 Aug): annotated against the REAL domain type rather than left to
// structural inference. Inferred from this literal alone, `durationMinutes:
// 10` narrows to `number`, and `typeof mockCircles` then types the whole
// scenario — which made `bedtimeCircles`' honest `durationMinutes: null`
// unassignable and put a red in `tsc`. The null was never the liar: a
// circle with no dose is an ordinary circle (`circles.duration_minutes` is
// a nullable integer, `MyCircle.durationMinutes` is `number | null`,
// `listMyCircles` coalesces `?? null`, and every consumer truthiness-guards
// it — today.tsx:1323/1591, edit-circle.tsx:77, my-practices.tsx:189).
// "Read before bed" really has no dose; that is why it was photographed.
// MyCircle[] also makes this fixture fail honestly if the domain type moves.
const mockCircles: MyCircle[] = [
  {
    id: CIRCLE,
    name: 'Stretching/Yoga moves',
    timeOfDay: null,
    startDate: '2026-07-05',
    durationDays: 21,
    practiceName: 'Stretching/Yoga moves',
    practiceIsUserCreated: true,
    durationMinutes: 10,
    inviteCode: 'AAAAAA',
    createdBy: CATHERINE_S,
    resourceUrl: null,
    instructions: null,
    isPublic: false,
    closedToJoins: false,
    ralliedOnAt: '2026-07-25T17:07:53.102Z',
    completedAt: null,
    myJoinSource: 'invite',
    wallSeenAt: null,
    myFinishedAt: null,
  },
];

const member = (userId: string, name: string, joinedAt: string) => ({
  userId,
  name,
  avatarUrl: null,
  role: userId === CATHERINE_S ? 'owner' : 'member',
  birthMonth: null,
  birthDay: null,
  celebrateBirthday: true,
  timezone: 'Europe/London',
  joinedAt,
  awaySince: null,
  finishedAt: null,
});

const mockMembers = [
  member(CATHERINE_S, 'Catherine S', '2026-07-05T01:52:17.462Z'),
  member(RUSS, 'Russ', '2026-07-05T05:16:54.768Z'),
  member(CATHERINE, 'Catherine', '2026-07-05T21:33:12.381Z'),
  member(CATHY_S, 'Cathy S', '2026-07-22T16:00:11.004Z'),
];

const done = (userId: string, localDate: string) => ({
  userId,
  localDate,
  kind: 'self' as const,
  coveredBy: null,
  createdAt: `${localDate}T12:00:00.000Z`,
});

// The live shape on 16 Aug: Catherine S and Cathy S in today, Russ in
// yesterday (1 quiet day — active), Catherine last seen 22 July (25 quiet
// days — RESTING, and therefore out of the denominator).
const mockPresence = [
  done(CATHERINE, '2026-07-22'),
  done(RUSS, '2026-08-12'),
  done(RUSS, '2026-08-13'),
  done(CATHY_S, '2026-08-14'),
  done(RUSS, '2026-08-15'),
  done(CATHERINE_S, '2026-08-15'),
  done(CATHERINE_S, TODAY),
  done(CATHY_S, TODAY),
];

// THE SECOND CARD, and the one ruling 2 exists for. Two members; Alex's
// last completion was 11 Aug, exactly RESTING_QUIET_DAYS_THRESHOLD days
// back, so 16 August is the morning he left the active roster — dropping
// it to one, and taking the lone-celebration branch while his own penguin
// sat unticked directly beneath the sentence.
const BEDTIME_CIRCLE = 'd215e065-0ac4-4b5a-9302-d18bd192e866';
const ALEX = '8c4400ba-39c0-46e2-807d-3b4a9ebb6fa3';

const bedtimeCircles = [
  {
    ...mockCircles[0],
    id: BEDTIME_CIRCLE,
    name: 'Read before bed',
    startDate: '2026-07-10',
    practiceName: 'Read before bed',
    createdBy: ALEX,
    durationMinutes: null,
  },
];

const bedtimeMembers = [
  member(ALEX, 'Alex Stewart', '2026-07-10T22:31:05.355Z'),
  member(CATHY_S, 'Cathy S', '2026-07-13T19:15:12.823Z'),
];

const bedtimePresence = [
  done(ALEX, '2026-08-09'),
  done(ALEX, '2026-08-10'),
  done(ALEX, '2026-08-11'),
  done(CATHY_S, '2026-08-14'),
  done(CATHY_S, '2026-08-15'),
  done(CATHY_S, TODAY),
];

/** Which circle the mocked fetchers serve. Swapped per describe, because
 * the two readings Cat photographed are two different circles and each
 * one has to be rendered by the real screen to be worth anything. */
const mockScenario: {
  circles: typeof mockCircles;
  members: typeof mockMembers;
  presence: typeof mockPresence;
  sessionUserId: string;
} = {
  circles: mockCircles,
  members: mockMembers,
  presence: mockPresence,
  sessionUserId: RUSS,
};

const mockWeek = [
  { date: '2026-08-10', state: 'earned', heldBy: null },
  { date: '2026-08-11', state: 'earned', heldBy: null },
  { date: '2026-08-12', state: 'earned', heldBy: null },
  { date: '2026-08-13', state: 'earned', heldBy: null },
  { date: '2026-08-14', state: 'missed', heldBy: null },
  { date: '2026-08-15', state: 'earned', heldBy: null },
  { date: TODAY, state: 'missed', heldBy: null },
];

const mockGlow = {
  glow: 4,
  state: 'glowing',
  emberDeadline: null,
  heldToday: false,
  shelterUsed: 0,
  shelterCapacity: 1,
  pebbles: 6,
  heldByToday: null,
  longestRally: 21,
  endedAtCliff: false,
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = require('react');
    useEffect(() => {
      cb();
    }, [cb]);
  },
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: mockScenario.sessionUserId } } }),
}));

// THE ARGUMENT MATTERS HERE, and a mock that drops it silently passes.
// `getLocalDateString()` with no argument is "what day is it" and is
// pinned; the SAME function with a Date is "what day was that", and
// attachRestingStatus calls it that way to turn each member's `joinedAt`
// into a local date. A blanket `() => '2026-08-16'` (which is what the
// BG1 harness carries, correctly, because it never exercises resting)
// makes every member look like they joined TODAY — and isResting's
// new-joiner grace then returns false for the whole roster, so the fade
// never appears and the line reads "2 of 4" with nothing at the edge.
jest.mock('@/lib/date', () => {
  const actual = jest.requireActual('@/lib/date');
  return {
    ...actual,
    getLocalDateString: (d?: Date) => (d ? actual.getLocalDateString(d) : '2026-08-16'),
  };
});

jest.mock('@/lib/profile', () => ({
  getMyProfile: jest.fn(async () => mockProfile),
  markPhotoAskSeen: jest.fn(async () => {}),
  markReentryAcknowledged: jest.fn(async () => {}),
  markRemindersAskSeen: jest.fn(async () => {}),
  setAlarmReminder: jest.fn(async () => {}),
}));

jest.mock('@/lib/circle', () => ({
  ...jest.requireActual('@/lib/circle'),
  listMyCircles: jest.fn(async () => mockScenario.circles),
  getCircleMembers: jest.fn(async () => mockScenario.members),
  getCirclePresence: jest.fn(async () => mockScenario.presence),
  subscribeToCirclePresence: jest.fn(() => () => {}),
}));

jest.mock('@/lib/caps', () => ({
  ...jest.requireActual('@/lib/caps'),
  getMyCircleCap: jest.fn(async () => 3),
}));

jest.mock('@/lib/checkin', () => ({
  ...jest.requireActual('@/lib/checkin'),
  getDailyQuestion: jest.fn(async () => null),
  getTodayReflection: jest.fn(async () => ({
    mood: null,
    line1: null,
    line2: null,
    questionId: null,
    questionAnswer: null,
    questionSkipped: false,
  })),
  recordCheckinWithoutReflection: jest.fn(async () => ({ earnedToday: true })),
}));

jest.mock('@/lib/glow', () => ({
  ...jest.requireActual('@/lib/glow'),
  getMyGlow: jest.fn(async () => mockGlow),
  getMyWeek: jest.fn(async () => mockWeek),
  getGlowForCircleMates: jest.fn(async () => new Map<string, number>()),
  getMyFreshPebbleGifts: jest.fn(async () => []),
  recordMyRallyCliff: jest.fn(async () => null),
}));

jest.mock('@/lib/journey', () => ({
  ...jest.requireActual('@/lib/journey'),
  getMyLastCelebratedDay: jest.fn(async () => 21),
  resumeMyRally: jest.fn(async () => {}),
}));

jest.mock('@/lib/reflections', () => ({
  ...jest.requireActual('@/lib/reflections'),
  hasUnrespondedDayObservation: jest.fn(async () => false),
}));

jest.mock('@/lib/warmth', () => ({
  ...jest.requireActual('@/lib/warmth'),
  getFreshWarmth: jest.fn(async () => []),
  getWallTeaser: jest.fn(async () => null),
  markWarmthSeen: jest.fn(async () => {}),
}));

jest.mock('@/lib/alarmReminder', () => ({
  ...jest.requireActual('@/lib/alarmReminder'),
  resolvePrefillAlarmTime: jest.fn(async () => ({ time: '08:00', prefilled: false })),
  syncDailyReminder: jest.fn(async () => {}),
}));

jest.mock('@/lib/notifications', () => ({
  ...jest.requireActual('@/lib/notifications'),
  updateNotificationPrefs: jest.fn(async () => {}),
}));

jest.mock('@/lib/chime', () => ({ unlockAudioContext: jest.fn() }));

function visibleText(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((c): c is string => typeof c === 'string');
}

/** The `avatarWrap` View around a given member's Avatar — found by walking
 * up from the Avatar itself rather than by index, so a layout change to the
 * strip doesn't silently move which element is asserted on. */
function avatarWrapFor(tree: ReactTestRenderer, userId: string): ReactTestInstance {
  const avatar = tree.root
    .findAllByType(Avatar)
    .find((a) => a.props.userId === userId);
  if (!avatar) throw new Error(`no Avatar rendered for ${userId}`);
  let node: ReactTestInstance | null = avatar.parent;
  while (node) {
    if (node.type === View) {
      const flat = StyleSheet.flatten(node.props.style) as { position?: string } | undefined;
      if (flat?.position === 'relative') return node;
    }
    node = node.parent;
  }
  throw new Error(`no avatarWrap above ${userId}'s Avatar`);
}

function opacityOf(node: ReactTestInstance): number {
  const flat = StyleSheet.flatten(node.props.style) as { opacity?: number } | undefined;
  return flat?.opacity ?? 1;
}

describe('Today — an excluded member reads as at-the-edge (HC1 ruling 1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Today = require('@/app/(app)/(tabs)/today').default as React.ComponentType;

  let tree: ReactTestRenderer;

  beforeEach(async () => {
    (captureError as jest.Mock).mockClear();
    await act(async () => {
      tree = create(React.createElement(Today));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it('still renders every member — the fade is a fade, never a removal', () => {
    // PA2 memo §10 Q1: someone quietly disappearing from a huddle is the
    // feeling this product exists to prevent. Four members, four avatars.
    const shown = tree.root.findAllByType(Avatar).map((a) => a.props.userId);
    for (const id of [CATHERINE_S, RUSS, CATHERINE, CATHY_S]) {
      expect(shown).toContain(id);
    }
  });

  it('fades the member the headcount excludes, and only that member', () => {
    // Catherine's last completion was 22 July — 25 quiet days, so RS1 has
    // her at the edge and the denominator drops her. Against d732fd0 every
    // one of these was 1: Today had no fade at all.
    expect(opacityOf(avatarWrapFor(tree, CATHERINE))).toBe(0.5);
    expect(opacityOf(avatarWrapFor(tree, CATHERINE_S))).toBe(1);
    expect(opacityOf(avatarWrapFor(tree, RUSS))).toBe(1);
    expect(opacityOf(avatarWrapFor(tree, CATHY_S))).toBe(1);
  });

  it('reproduces Cat’s reading: "2 of 3 in today" over four avatars', () => {
    // The counting rule is UNTOUCHED by HC1 — this is the same sentence
    // d732fd0 rendered, pinned so ruling 1 cannot quietly become a ruling
    // about the denominator. It PASSES against d732fd0, deliberately: it
    // is the control that proves the denominator did not move.
    expect(visibleText(tree).some((t) => t.includes('2 of 3 in today'))).toBe(true);
  });
});

describe('Today — no 🔥 over an unticked avatar (HC1 ruling 2, "Read before bed")', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Today = require('@/app/(app)/(tabs)/today').default as React.ComponentType;

  let tree: ReactTestRenderer;

  beforeAll(() => {
    mockScenario.circles = bedtimeCircles;
    mockScenario.members = bedtimeMembers;
    mockScenario.presence = bedtimePresence;
    mockScenario.sessionUserId = CATHY_S;
  });

  afterAll(() => {
    mockScenario.circles = mockCircles;
    mockScenario.members = mockMembers;
    mockScenario.presence = mockPresence;
    mockScenario.sessionUserId = RUSS;
  });

  beforeEach(async () => {
    (captureError as jest.Mock).mockClear();
    await act(async () => {
      tree = create(React.createElement(Today));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it('THE FLIP CASE, end to end: the card no longer claims everyone is in', () => {
    // Against d732fd0 this exact screen rendered
    // "that's everyone in today 🔥 · view circle →" with Alex unticked
    // beneath it. This assertion is signature-agnostic — it goes through
    // the real screen, so it measures the RENDER, not the helper.
    const texts = visibleText(tree);
    expect(texts.some((t) => t.includes("that's everyone in today"))).toBe(false);
    expect(texts.some((t) => t.includes('1 of 1 in today'))).toBe(true);
  });

  it('Alex is still shown, and shown at the edge', () => {
    const shown = tree.root.findAllByType(Avatar).map((a) => a.props.userId);
    expect(shown).toContain(ALEX);
    expect(opacityOf(avatarWrapFor(tree, ALEX))).toBe(0.5);
    expect(opacityOf(avatarWrapFor(tree, CATHY_S))).toBe(1);
  });
});
