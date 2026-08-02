/**
 * BG1 (1 Aug) — TODAY MUST SURVIVE ITS OWN SECOND RENDER.
 *
 * THE DEFECT THIS PINS. Today's first render always takes the
 * `if (isLoading) return <ActivityIndicator/>` early return; the second,
 * once load() resolves, runs the whole screen. AL1 (d3e5eb1, 30 July)
 * added its alarm-prefill useEffect BELOW that return, beside the
 * reminders card it feeds — the tidy-looking place, and the wrong one. So
 * render 1 called 53 hooks and render 2 called 54, and React threw
 * "Rendered more hooks than during the previous render." on the loaded
 * render of EVERY account, on BOTH platforms, from the moment AL1 went
 * live. Today's own error boundary caught it and the floating tab bar
 * survived (NR1 job 1c working exactly as designed), which is precisely
 * why it read as one person's data bug rather than a total outage.
 *
 * WHY THE BOUNDARY STAYS ON HERE. The screen under test is the boundaried
 * default export — what the tab actually renders. A crash therefore does
 * not throw out of `create()`; it lands on the recovery screen, silently,
 * exactly as it did in production. So the assertions are: the recovery
 * copy is ABSENT, Today's real content is PRESENT, and nothing reached
 * captureError with a `boundary` tag. Any hook added below that early
 * return again fails all three, and the failure message carries the real
 * error the boundary swallowed.
 *
 * WHY THIS FILE IS NOT CO-LOCATED, and it is not a style preference.
 * `app/` IS the router. Anything inside a Tabs group becomes a TAB: this
 * test first shipped as app/(app)/(tabs)/today.test.tsx and put a sixth
 * button labelled "/today.test" on the live floating tab bar, next to
 * Rally — caught by counting [role="tab"] on rally21.com, not by reading
 * the diff. (app/(app)/checkin.test.tsx and journey-gate.test.tsx sit in
 * the STACK group, so they only ever added invisible routes — which is
 * why the pattern looked safe.) Every one of them is still compiled into
 * the production web bundle, jest.mock calls and all, and that is worth
 * fixing separately; a screen test belongs outside app/ regardless.
 *
 * THE DATA IS RUSS'S OWN, from the account that reported it (8174d14d,
 * 1 Aug): one circle of four, a user-created practice, a pebble-held
 * 21-day glow, a re-entry gap of three days, and FA1's first ask (CON-10)
 * pinned for the day. None of it is load-bearing for the crash — the
 * defect is unconditional — but it is the state that was actually on
 * screen, so the harness reproduces the report rather than a reduction of
 * it. ESLint's react-hooks/rules-of-hooks catches this class too and is
 * already configured as an error; this test is the second lock, because a
 * lint rule only helps if the lint is run.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { STRINGS } from '@/constants/strings';
import { captureError } from '@/lib/sentry';

const RUSS = '8174d14d-01d4-4371-8b3e-c0647ce2f23f';
const CATHERINE_S = '75ec0d88-27de-4227-ab62-3d049b369960';
const CATHERINE = 'a9203f91-dd8f-46b4-861e-cfca19cb1b31';
const CATHY_S = 'decc56b0-a748-448c-a469-2b0ac6957163';
const CIRCLE = 'da4766c3-5f88-441e-b834-1a25912a8e52';
const TODAY = '2026-08-01';

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

const mockCircles = [
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

const member = (
  userId: string,
  name: string,
  avatarUrl: string | null,
  role: string,
  joinedAt: string
) => ({
  userId,
  name,
  avatarUrl,
  role,
  birthMonth: null,
  birthDay: null,
  celebrateBirthday: true,
  timezone: 'America/New_York',
  joinedAt,
  awaySince: null,
  finishedAt: null,
});

const mockMembers = [
  member(CATHERINE_S, 'Catherine S', 'https://example.test/a.png', 'owner', '2026-07-05T01:52:17.462Z'),
  member(RUSS, 'Russ', null, 'member', '2026-07-05T05:16:54.768Z'),
  member(CATHERINE, 'Catherine', 'https://example.test/b.jpeg', 'member', '2026-07-05T21:33:12.381Z'),
  member(CATHY_S, 'Cathy S', 'https://example.test/c.jpeg', 'member', '2026-07-22T16:00:11.004Z'),
];

const done = (
  userId: string,
  localDate: string,
  kind: 'self' | 'covered' = 'self',
  coveredBy: string | null = null
) => ({ userId, localDate, kind, coveredBy, createdAt: `${localDate}T12:00:00.000Z` });

// Russ's own run, plus the covers and circle-mate days around it — enough
// history for countRallyDays, computeSignal and the re-entry detection to
// see the shape they actually saw (last own day 29 July, three days back).
const mockPresence = [
  done(CATHERINE_S, '2026-07-04'),
  done(RUSS, '2026-07-05'),
  done(CATHERINE_S, '2026-07-05'),
  done(CATHERINE, '2026-07-05'),
  done(CATHERINE, '2026-07-06'),
  done(RUSS, '2026-07-06'),
  done(CATHERINE_S, '2026-07-06', 'covered', CATHERINE),
  done(RUSS, '2026-07-07'),
  done(CATHERINE_S, '2026-07-07', 'covered', RUSS),
  done(RUSS, '2026-07-08'),
  done(RUSS, '2026-07-09'),
  done(RUSS, '2026-07-10'),
  done(CATHERINE, '2026-07-10', 'covered', RUSS),
  done(RUSS, '2026-07-11'),
  done(RUSS, '2026-07-12'),
  done(CATHERINE_S, '2026-07-13'),
  done(RUSS, '2026-07-13'),
  done(RUSS, '2026-07-14'),
  done(RUSS, '2026-07-15'),
  done(CATHERINE, '2026-07-16'),
  done(RUSS, '2026-07-16', 'covered', CATHERINE),
  done(RUSS, '2026-07-17'),
  done(RUSS, '2026-07-18'),
  done(RUSS, '2026-07-19'),
  done(RUSS, '2026-07-20'),
  done(RUSS, '2026-07-21'),
  done(CATHY_S, '2026-07-22'),
  done(RUSS, '2026-07-22', 'covered', CATHY_S),
  done(CATHY_S, '2026-07-24'),
  done(RUSS, '2026-07-24'),
  done(RUSS, '2026-07-25'),
  done(RUSS, '2026-07-26', 'covered', CATHY_S),
  done(CATHY_S, '2026-07-26'),
  done(RUSS, '2026-07-27'),
  done(CATHY_S, '2026-07-27'),
  done(RUSS, '2026-07-28'),
  done(RUSS, '2026-07-29'),
  done(CATHY_S, '2026-07-29'),
  done(CATHY_S, '2026-07-30'),
];

const mockWeek = [
  { date: '2026-07-26', state: 'held', heldBy: 'pebble' },
  { date: '2026-07-27', state: 'earned', heldBy: null },
  { date: '2026-07-28', state: 'earned', heldBy: null },
  { date: '2026-07-29', state: 'earned', heldBy: null },
  { date: '2026-07-30', state: 'held', heldBy: 'pebble' },
  { date: '2026-07-31', state: 'held', heldBy: 'pebble' },
  { date: TODAY, state: 'held', heldBy: 'pebble' },
];

const mockGlow = {
  glow: 21,
  state: 'glowing',
  emberDeadline: null,
  heldToday: true,
  shelterUsed: 0,
  shelterCapacity: 1,
  pebbles: 6,
  heldByToday: 'pebble',
  longestRally: 21,
  endedAtCliff: false,
};

// FA1's first ask, as actually served to this account on 1 Aug: CON-10,
// carrying the bank's `*accent*` markers the teaser has to strip.
const mockQuestion = {
  id: '431154f2-3bac-4ed6-832a-5b2672d3b19d',
  dimension: 'CON',
  prompt: "What's the most helpful way for someone to *support* you?",
  format: 'short_text',
  depth: 'L2',
  options: null,
};

const mockTeaser = {
  kind: 'celebration',
  userId: CATHY_S,
  body: 'Cathy S has been glowing 7 days 🔥',
  createdAt: '2026-07-29T13:53:49.382Z',
};

const mockMateGlows = new Map<string, number>([
  [CATHY_S, 12],
  [RUSS, 21],
]);

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
  useAuth: () => ({ session: { user: { id: '8174d14d-01d4-4371-8b3e-c0647ce2f23f' } } }),
}));

jest.mock('@/lib/date', () => ({
  ...jest.requireActual('@/lib/date'),
  getLocalDateString: () => '2026-08-01',
}));

jest.mock('@/lib/profile', () => ({
  getMyProfile: jest.fn(async () => mockProfile),
  markPhotoAskSeen: jest.fn(async () => {}),
  markReentryAcknowledged: jest.fn(async () => {}),
  markRemindersAskSeen: jest.fn(async () => {}),
  setAlarmReminder: jest.fn(async () => {}),
}));

jest.mock('@/lib/circle', () => ({
  ...jest.requireActual('@/lib/circle'),
  listMyCircles: jest.fn(async () => mockCircles),
  getCircleMembers: jest.fn(async () => mockMembers),
  getCirclePresence: jest.fn(async () => mockPresence),
  subscribeToCirclePresence: jest.fn(() => () => {}),
}));

jest.mock('@/lib/caps', () => ({
  ...jest.requireActual('@/lib/caps'),
  getMyCircleCap: jest.fn(async () => 3),
}));

jest.mock('@/lib/checkin', () => ({
  ...jest.requireActual('@/lib/checkin'),
  getDailyQuestion: jest.fn(async () => mockQuestion),
  getTodayReflection: jest.fn(async () => ({
    mood: null,
    line1: null,
    line2: null,
    questionId: mockQuestion.id,
    questionAnswer: null,
    questionSkipped: false,
  })),
  recordCheckinWithoutReflection: jest.fn(async () => ({ earnedToday: true })),
}));

jest.mock('@/lib/glow', () => ({
  ...jest.requireActual('@/lib/glow'),
  getMyGlow: jest.fn(async () => mockGlow),
  getMyWeek: jest.fn(async () => mockWeek),
  getGlowForCircleMates: jest.fn(async () => mockMateGlows),
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
  getWallTeaser: jest.fn(async () => mockTeaser),
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

/** Every string the rendered tree actually put on screen. */
function visibleText(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((c): c is string => typeof c === 'string');
}

/** The error the boundary swallowed, if it swallowed one — so a failure
 * reports the real cause instead of only "the recovery screen showed". */
function swallowedError(): string {
  const calls = (captureError as jest.Mock).mock.calls.filter(
    ([, tags]) => tags && 'boundary' in tags
  );
  if (calls.length === 0) return 'none';
  return calls.map(([e]) => (e instanceof Error ? e.message : String(e))).join(' | ');
}

describe('Today — the loaded render (BG1)', () => {
  // The screen is required here, not imported at module scope, so the
  // fixtures above are initialised before the mock factories run.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Today = require('@/app/(app)/(tabs)/today').default as React.ComponentType;

  let tree: ReactTestRenderer;

  beforeEach(async () => {
    (captureError as jest.Mock).mockClear();
    await act(async () => {
      tree = create(React.createElement(Today));
    });
    // Let load()'s promises settle so the screen renders its LOADED pass —
    // the render the defect lived on. A single flush is not enough: the
    // per-circle fetches are a second await inside the first.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it('does not fall through to the error boundary', () => {
    expect(swallowedError()).toBe('none');
    expect(visibleText(tree)).not.toContain(STRINGS.errorBoundaryTitle);
  });

  it('renders the day itself — greeting, glow, and the way to check in', () => {
    const texts = visibleText(tree);
    // This circle carries a duration and no resource link, so the CTA slot
    // is the two-button timer choice rather than the single "check in".
    expect(texts).toContain(STRINGS.markDoneCta);
    expect(texts).toContain(STRINGS.startTimerCta);
    expect(texts).toContain(STRINGS.glowGlowingLabel(21));
    expect(texts.some((t) => t.startsWith('Good ') && t.includes('Russ'))).toBe(true);
  });

  it('renders the welcome-back spot and tonight’s question, markers stripped', () => {
    const texts = visibleText(tree);
    expect(texts).toContain(STRINGS.todaySpotKickerWelcomeBack);
    expect(texts).toContain(
      STRINGS.reflectionTeaser("What's the most helpful way for someone to *support* you?")
    );
    expect(texts.some((t) => t.includes('*support*'))).toBe(false);
  });
});
