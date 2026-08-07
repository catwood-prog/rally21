/**
 * QP1 (7 Aug, Cat's device walk) — THE CHECK-IN CARD MUST SHOW THE SENTENCE
 * THIS PERSON WAS ACTUALLY ASKED, NOT THE BANK'S TEMPLATE.
 *
 * THE DEFECT THIS PINS, from Cat's 22:23 screenshot: today's question read
 * `You said "{answer}" reliably helps you recharge. When did you last do
 * it?` — the literal `{answer}` placeholder, on a real phone.
 *
 * The server was innocent and the database was clean. `get_daily_question`
 * interpolates the follow-up template and writes the finished sentence to
 * `reflections.question_prompt_snapshot`, and it PINS that row the moment
 * it picks the question. So checkin.tsx's two branches disagreed:
 *
 *   - FRESH open — no row yet, so getDailyQuestion() runs the RPC and the
 *     screen renders its interpolated return. Correct, always.
 *   - RE-OPEN — the row now exists, so the resume branch called
 *     getQuestionById() and rendered `questions.prompt`: the RAW TEMPLATE.
 *
 * That is not an edge case. Every user saw the right sentence on the first
 * open of a day and the template on every re-open of the same day, across
 * all ten FU codes. `getTodayReflection` selected six columns and the one
 * holding the correct text was the one it did not ask for.
 *
 * WHY THE RE-OPEN CASE IS THE WHOLE POINT. A test that mounts a fresh
 * check-in passes against the broken build — that path was never wrong.
 * These cases mount against an EXISTING pinned row whose snapshot differs
 * from the question's current template, which is the only shape that can
 * tell the two branches apart.
 *
 * THE DATA IS THE SCREENSHOT'S OWN ROW (FU-07, 2026-08-07, the account that
 * reported it): a substantive reflection already saved for the day, this
 * circle already completed — which is exactly why she landed on the form
 * again instead of the skip-redirect — with the answer "Meditation" frozen
 * into the snapshot and the bank still holding the `{answer}` form.
 *
 * NOT co-located under app/ — see screens-tests/today.test.tsx's note: a
 * test file inside app/ is compiled into the production bundle, and inside
 * a Tabs group it becomes a visible tab.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

// The account that reported it. Spelled out again inside the auth mock
// below, which babel-plugin-jest-hoist lifts above every const in the file.
const CIRCLE = 'aaaaaaaa-0000-4000-8000-000000000001';
const TODAY = '2026-08-07';
const QUESTION_ID = 'ffffffff-0000-4000-8000-00000000f007';

/** FU-07 as the bank holds it today — the raw follow-up template. This is
 * the string that reached Cat's screen, and it must never render again. */
const RAW_TEMPLATE = 'You said "{answer}" reliably helps you recharge. When did you last do it?';

/** FU-07 as get_daily_question froze it for her that morning: her own
 * earlier answer interpolated, wrapped in the bank's `*accent*` markers so
 * AccentedText italicises it. */
const SNAPSHOT = 'You said "*Meditation*" reliably helps you recharge. When did you last do it?';

/** The same question a day earlier, when the bank's wording was different
 * (MN1's rewrite moved it). Proves the snapshot wins on its own merits, not
 * merely because the template happens to carry a token. */
const OLD_SNAPSHOT = '"*Laughing*" reliably restores you. When did you last actually do it?';

/** The pinned reflections row for today, in the shape getTodayReflection
 * really returns. Reassigned per case; `mock`-prefixed because the
 * jest.mock factory below reads it, which is the one out-of-scope
 * reference babel-plugin-jest-hoist permits. */
let mockExisting: {
  mood: number | null;
  line1: string | null;
  line2: string | null;
  questionId: string | null;
  questionPromptSnapshot: string | null;
  questionAnswer: string | null;
  questionSkipped: boolean;
} | null = null;

let mockAlreadyCompletedThisCircle = false;

/** ONE router object for the whole file, deliberately. checkin.tsx's load
 * effect lists `router` in its dependency array, so a `useRouter` mock that
 * returns a fresh object per render re-runs the effect on every render it
 * causes — an infinite mount that hangs act() rather than failing. The real
 * expo-router returns a stable instance; this mirrors that. */
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
const mockParams = { circleId: CIRCLE };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    session: { user: { id: '8174d14d-01d4-4371-8b3e-c0647ce2f23f', created_at: '2026-07-05T00:00:00Z' } },
  }),
}));

jest.mock('@/lib/date', () => ({
  ...jest.requireActual('@/lib/date'),
  getLocalDateString: () => '2026-08-07',
}));

jest.mock('@/lib/circle', () => ({
  ...jest.requireActual('@/lib/circle'),
  getCircleById: jest.fn(async () => ({
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    name: 'Morning Movers',
    practiceName: 'Walk 20 minutes',
    startDate: '2026-07-05',
  })),
}));

jest.mock('@/lib/profile', () => ({
  ...jest.requireActual('@/lib/profile'),
  getMyProfile: jest.fn(async () => ({ has_seen_voice_hint: true })),
  markVoiceHintSeen: jest.fn(async () => {}),
  setReflectionsOptOut: jest.fn(async () => {}),
}));

jest.mock('@/lib/chime', () => ({ unlockAudioContext: jest.fn(), playCheckinPop: jest.fn() }));

/** Only the four reads the load effect makes are stubbed. Everything that
 * DECIDES the prompt — resolveQuestionPromptWithAccents, AccentedText, the
 * resume branch itself — runs for real, which is the entire point. */
jest.mock('@/lib/checkin', () => ({
  ...jest.requireActual('@/lib/checkin'),
  getTodayReflection: jest.fn(async () => mockExisting),
  hasCompletedToday: jest.fn(async () => mockAlreadyCompletedThisCircle),
  getQuestionById: jest.fn(async () => ({
    id: 'ffffffff-0000-4000-8000-00000000f007',
    dimension: 'STR',
    prompt: 'You said "{answer}" reliably helps you recharge. When did you last do it?',
    format: 'short_text',
    depth: 'L1',
    options: null,
  })),
  getDailyQuestion: jest.fn(async () => ({
    id: 'ffffffff-0000-4000-8000-00000000f007',
    dimension: 'STR',
    // The RPC interpolates before it returns — a fresh open was always right.
    prompt: 'You said "*Meditation*" reliably helps you recharge. When did you last do it?',
    format: 'short_text',
    depth: 'L1',
    options: null,
  })),
  getQuestionWhy: jest.fn(async () => null),
}));

/** Every string the rendered tree actually put on screen, joined. Joined
 * rather than listed because AccentedText splits one sentence across a
 * parent Text and an italic child, so no single node holds the question. */
function renderedText(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((c): c is string => typeof c === 'string')
    .join(' ');
}

async function renderCheckIn(): Promise<{ tree: ReactTestRenderer; text: string }> {
  // Required here, not imported at module scope, so the fixtures above are
  // initialised before the mock factories run.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const CheckIn = require('@/app/(app)/checkin').default as React.ComponentType;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(React.createElement(CheckIn));
  });
  // The load effect awaits four reads and then a fifth (getQuestionById)
  // inside the resume branch, so one flush is not enough.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { tree, text: renderedText(tree) };
}

describe('the check-in question on a RE-OPEN of the same day (QP1)', () => {
  let tree: ReactTestRenderer;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExisting = null;
    mockAlreadyCompletedThisCircle = false;
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it('THE SCREENSHOT, fixed: re-opening an already-saved day shows the interpolated sentence, never the template', async () => {
    // Cat's own row: the day already reflected on and this circle already
    // completed, which is what lands her back on the form rather than the
    // skip-redirect.
    mockExisting = {
      mood: 4,
      line1: 'a long walk before the heat',
      line2: null,
      questionId: QUESTION_ID,
      questionPromptSnapshot: SNAPSHOT,
      questionAnswer: 'yesterday evening',
      questionSkipped: false,
    };
    mockAlreadyCompletedThisCircle = true;

    const rendered = await renderCheckIn();
    tree = rendered.tree;

    // The defect, stated the way it was seen: no unsubstituted token of any
    // kind reached the screen. The raw template carries no `*` markers, so
    // on the pre-fix build AccentedText passed it through whole and it
    // appears here verbatim — which is what the second assertion catches.
    expect(rendered.text).not.toContain('{');
    expect(rendered.text).not.toContain(RAW_TEMPLATE);
    // And the right sentence is PRESENT, not merely the wrong one absent —
    // including the interpolated answer, which only the snapshot holds.
    expect(rendered.text).toContain('reliably helps you recharge');
    expect(rendered.text).toContain('Meditation');

    // The resume branch is genuinely the one that ran: a fresh open would
    // have gone to the RPC instead, which is the path that was never broken
    // and the reason a naive test reproduces the blind spot.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getQuestionById, getDailyQuestion } = require('@/lib/checkin');
    expect(getQuestionById).toHaveBeenCalledWith(QUESTION_ID);
    expect(getDailyQuestion).not.toHaveBeenCalled();
  });

  it('the answer keeps its accent treatment — the snapshot is rendered THROUGH AccentedText, not flattened', async () => {
    mockExisting = {
      mood: 4,
      line1: 'a long walk before the heat',
      line2: null,
      questionId: QUESTION_ID,
      questionPromptSnapshot: SNAPSHOT,
      questionAnswer: 'yesterday evening',
      questionSkipped: false,
    };
    mockAlreadyCompletedThisCircle = true;

    const rendered = await renderCheckIn();
    tree = rendered.tree;

    // The `*Meditation*` markers must be CONSUMED by the renderer, not
    // stripped upstream and not printed raw. The journal's plain-text
    // resolver strips them; check-in's must not, which is why the two share
    // a fallback rule but not a resolver.
    expect(rendered.text).not.toContain('*');
    const italic = tree.root
      .findAllByType(Text)
      .filter((n) => n.props.children === 'Meditation');
    expect(italic).toHaveLength(1);
  });

  it('a re-open of a PIN STUB — opened, backed out, opened again, nothing saved — is clean too', async () => {
    // get_daily_question pins the row the moment it picks the question, so
    // this shape exists for anyone who merely looked at check-in today.
    mockExisting = {
      mood: null,
      line1: null,
      line2: null,
      questionId: QUESTION_ID,
      questionPromptSnapshot: SNAPSHOT,
      questionAnswer: null,
      questionSkipped: false,
    };
    mockAlreadyCompletedThisCircle = false;

    const rendered = await renderCheckIn();
    tree = rendered.tree;

    expect(rendered.text).not.toContain('{');
    expect(rendered.text).toContain('reliably helps you recharge');
    expect(rendered.text).toContain('Meditation');
  });

  it('a snapshot the bank has since REWORDED still wins — the day is retold as it was asked', async () => {
    mockExisting = {
      mood: 3,
      line1: 'quiet morning',
      line2: null,
      questionId: QUESTION_ID,
      questionPromptSnapshot: OLD_SNAPSHOT,
      questionAnswer: null,
      questionSkipped: false,
    };
    mockAlreadyCompletedThisCircle = true;

    const rendered = await renderCheckIn();
    tree = rendered.tree;

    expect(rendered.text).toContain('reliably restores you');
    expect(rendered.text).not.toContain('reliably helps you recharge');
    expect(rendered.text).toContain('Laughing');
  });

  it('a genuinely pre-snapshot row still falls back to the bank — the fallback is kept, not dropped', async () => {
    // The 11 live rows from 3–7 July, written before the snapshot column
    // existed. None of them points at a template carrying a token (measured
    // 7 Aug), so this fallback cannot surface a raw `{answer}` today — but
    // it must still render something rather than an empty card.
    mockExisting = {
      mood: 4,
      line1: 'early start',
      line2: null,
      questionId: QUESTION_ID,
      questionPromptSnapshot: null,
      questionAnswer: null,
      questionSkipped: false,
    };
    mockAlreadyCompletedThisCircle = true;

    const rendered = await renderCheckIn();
    tree = rendered.tree;

    expect(rendered.text).toContain('reliably helps you recharge');
  });

  it('a FRESH open is unchanged — the branch that was always right stays right', async () => {
    mockExisting = null;
    mockAlreadyCompletedThisCircle = false;

    const rendered = await renderCheckIn();
    tree = rendered.tree;

    expect(rendered.text).not.toContain('{');
    expect(rendered.text).toContain('Meditation');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getQuestionById, getDailyQuestion } = require('@/lib/checkin');
    expect(getDailyQuestion).toHaveBeenCalledWith(TODAY);
    expect(getQuestionById).not.toHaveBeenCalled();
  });
});

/**
 * The other half of the same defect, one layer down: the render fix above
 * is only possible because getTodayReflection now ASKS for the column. It
 * selected six and the seventh was the one that mattered — so this pins the
 * select list itself, which no render test can see.
 */
describe('getTodayReflection asks for the snapshot column (QP1)', () => {
  it('selects question_prompt_snapshot and returns it', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabase } = require('@/lib/supabase');
    const { getTodayReflection } = jest.requireActual('@/lib/checkin');

    const row = {
      mood: 4,
      line1: 'a long walk before the heat',
      line2: null,
      question_id: QUESTION_ID,
      question_prompt_snapshot: SNAPSHOT,
      question_answer: 'yesterday evening',
      question_skipped: false,
    };

    // Typed so the assertion below can read the column list back off the
    // call — an untyped jest.fn() infers a zero-length argument tuple.
    const select = jest.fn((columns: string) => ({
      columns,
      eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
    }));
    (supabase.from as jest.Mock).mockReturnValue({ select });

    const result = await getTodayReflection(TODAY);

    expect(select).toHaveBeenCalledTimes(1);
    expect(select.mock.calls[0][0]).toContain('question_prompt_snapshot');
    expect(result.questionPromptSnapshot).toBe(SNAPSHOT);
  });
});
