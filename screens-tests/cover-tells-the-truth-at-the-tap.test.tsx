/**
 * CV4 job 3 (27 Aug) — THE COVER SCREEN TELLS THE TRUTH AT THE TAP.
 *
 * Two rulings, both Cat's, both about the same screen refusing to lie.
 *
 * (1) THE COVER THAT LOST THE DAY. Until now every failed cover write fell
 * to `something went wrong — try again`, which says nothing and blames
 * nobody in particular. Cat ruled her own sentence for the case that
 * actually happens — someone in the circle got there first — with the wave
 * genuinely reachable from the refusal, not merely named in it.
 *
 * WHY TWO SQLSTATES AND NOT THE ONE THE SECTION NAMED. The section was
 * written around 23505, the unique violation on
 * `completions_circle_id_user_id_local_date_key`. Measured against the
 * live DB, two coverers in sequence do NOT produce it: the completions
 * INSERT policy ends with `NOT EXISTS (select 1 from completions c2 ...)`,
 * so RLS refuses the stale-pill case as 42501 long before the unique index
 * is consulted. 23505 needs a true race — both inserts in flight, neither
 * seeing the other's uncommitted row. Built to 23505 alone, Cat's sentence
 * would have shipped into a branch a six-account cohort would never reach.
 * Cat ruled the 42501 path in on 27 Aug, with the re-read that keeps it
 * honest: 42501 also means a rolled-over date, a lapsed membership, a
 * self-cover, so the sentence is only spoken once a read confirms the row.
 *
 * (2) THE COVER THAT WILL NOT HOLD. Past the covered person's monthly
 * capacity, `glow_day_states` writes, notifies, renders held — and holds
 * nothing. Eligibility stays WIDE (Cat's Option B); the screen simply says
 * what this cover will be, before the tap commits.
 *
 * WHAT EACH TEST IS WORTH AGAINST HEAD, said plainly rather than implied:
 *   23505 / 42501-confirmed / waves-off  — FAIL at HEAD (generic fallback)
 *   the honesty line at the tap          — FAIL at HEAD (nothing renders)
 *   42501-unconfirmed                    — SPLIT, and said exactly. Its
 *     COPY assertion is green both sides: HEAD shows the generic fallback
 *     here too, which is the point — this test is the guard that stops the
 *     new branch turning every unrelated 42501 (a rolled-over date, a
 *     lapsed membership, a self-cover) into a false claim, and it is the
 *     one that fails against a careless widening. Its RE-READ assertion
 *     cannot be green at HEAD, because HEAD has no re-read to count.
 *   re-read-itself-fails                 — GREEN BOTH SIDES. Same guard,
 *     copy only.
 *   no-missed-day-in-the-params           — GREEN BOTH SIDES. Same guard,
 *     for the triple the re-read is allowed to ask about at all.
 *
 * Measured in a pre-fix worktree at 9c20d4e (this file and the new strings
 * copied in, the screen and lib left as HEAD wrote them): 6 failed,
 * 4 passed of 10.
 *   the within-capacity control          — GREEN BOTH SIDES, by design
 *     (job 3(c)): the plain flow must be untouched. Measured, not
 *     asserted — it passed unchanged in the pre-fix worktree at 9c20d4e.
 *
 * THE ERRORS THROWN HERE ARE PLAIN OBJECTS, NOT `Error`s, because that is
 * what postgrest-js actually hands back (MS1: `e instanceof Error` is
 * false for every PostgREST failure in this codebase). A test that threw a
 * real Error would be testing a shape the app never sees.
 *
 * NOT CO-LOCATED (BG1): `app/` IS the router, so a co-located test would
 * mount a route. Screen tests reach the screen through the require below.
 */
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { MessageDialog } from '@/components/MessageDialog';
import { STRINGS } from '@/constants/strings';

const ME = 'c0a80a1e-0000-4000-8000-000000000001';
const MATE = 'c0a80a1e-0000-4000-8000-000000000002';
const CIRCLE = '11111111-1111-4111-8111-111111111111';
const MATE_NAME = 'Russ';
const MISSED = '2026-08-26';
const TODAY = '2026-08-27';

/** A refusal shaped exactly as postgrest-js delivers one. */
const pgError = (code: string, message: string) => ({ code, message, details: null, hint: null });

const DUPLICATE = pgError(
  '23505',
  'duplicate key value violates unique constraint "completions_circle_id_user_id_local_date_key"'
);
const RLS_REFUSAL = pgError('42501', 'new row violates row-level security policy for table "completions"');

/** Mutated per test; every mock factory reads it at CALL time. */
const mockState = {
  missedDate: MISSED as string | undefined,
  coverWillHold: undefined as string | undefined,
  coverThrows: null as unknown,
  completionExists: false,
  completionReadThrows: false,
  nudgeAllowed: true,
};

const mockCoverMember = jest.fn(async () => {
  if (mockState.coverThrows) throw mockState.coverThrows;
});
const mockHasCompletionFor = jest.fn(async () => {
  if (mockState.completionReadThrows) throw pgError('PGRST301', 'read failed');
  return mockState.completionExists;
});
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn(), setParams: jest.fn() }),
  useLocalSearchParams: () => ({
    circleId: CIRCLE,
    memberId: MATE,
    memberName: MATE_NAME,
    memberAvatarUrl: '',
    myName: 'Cat',
    ...(mockState.missedDate === undefined ? {} : { missedDate: mockState.missedDate }),
    ...(mockState.coverWillHold === undefined ? {} : { coverWillHold: mockState.coverWillHold }),
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: ME } } }),
}));

jest.mock('@/lib/date', () => ({
  ...jest.requireActual('@/lib/date'),
  getLocalDateString: () => TODAY,
}));

jest.mock('@/lib/circle', () => ({
  ...jest.requireActual('@/lib/circle'),
  coverMember: (...args: unknown[]) => mockCoverMember(...(args as [])),
  hasCompletionFor: (...args: unknown[]) => mockHasCompletionFor(...(args as [])),
}));

jest.mock('@/lib/glow', () => ({
  ...jest.requireActual('@/lib/glow'),
  // An empty nest keeps the pebble option off the list, so the option rows
  // under test are only ever cover and wave.
  getMyGlow: jest.fn(async () => ({ pebbles: 0 })),
  giftPebble: jest.fn(async () => {}),
}));

jest.mock('@/lib/wall', () => ({
  ...jest.requireActual('@/lib/wall'),
  isFriendNudgeEnabled: jest.fn(async () => mockState.nudgeAllowed),
  sendFriendNudge: jest.fn(async () => 'sent'),
}));

function visibleText(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((c): c is string => typeof c === 'string');
}

function openDialog(tree: ReactTestRenderer) {
  return tree.root.findAllByType(MessageDialog).find((d) => d.props.visible);
}

function tappable(tree: ReactTestRenderer, label: string) {
  return tree.root
    .findAllByType(TouchableOpacity)
    .find((t) => t.findAllByType(Text).some((x) => x.props.children === label));
}

/** The screen's own submit button, whatever it currently reads. */
function cta(tree: ReactTestRenderer) {
  return (
    tappable(tree, STRINGS.coverCta(MATE_NAME)) ??
    tappable(tree, STRINGS.waveCta(MATE_NAME)) ??
    tappable(tree, STRINGS.pebbleCta(MATE_NAME))
  );
}

describe('the cover screen tells the truth at the tap (CV4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const CoverAFriend = require('@/app/(app)/cover').default as React.ComponentType;

  let tree: ReactTestRenderer;

  const settle = async (ms = 0) => {
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    }
  };

  const render = async () => {
    await act(async () => {
      tree = create(React.createElement(CoverAFriend));
    });
    await settle();
  };

  const submit = async () => {
    await act(async () => {
      cta(tree)!.props.onPress();
    });
    await settle();
  };

  beforeEach(() => {
    mockState.missedDate = MISSED;
    mockState.coverWillHold = undefined;
    mockState.coverThrows = null;
    mockState.completionExists = false;
    mockState.completionReadThrows = false;
    mockState.nudgeAllowed = true;
    mockCoverMember.mockClear();
    mockHasCompletionFor.mockClear();
    mockReplace.mockClear();
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  // ── job 3(a) — the refusal speaks Cat's sentence ────────────────────

  it('(a) a 23505 renders the ruled sentence and leaves the wave one tap away', async () => {
    mockState.coverThrows = DUPLICATE;
    await render();
    // The cover really was the primed action before it failed, so a later
    // "the wave is primed" can never be a screen that was never on cover.
    expect(cta(tree)!.props).toBeDefined();
    expect(visibleText(tree)).toContain(STRINGS.coverCta(MATE_NAME));

    await submit();

    // AGAINST HEAD: `something went wrong — try again`.
    expect(openDialog(tree)?.props.message).toBe(STRINGS.coverAlreadyCoveredError);
    // The unique violation is certain on its own — no re-read is spent.
    expect(mockHasCompletionFor).not.toHaveBeenCalled();
    // "send them a wave HERE" is load-bearing: the wave option is on the
    // screen AND the submit button is now primed to send it.
    expect(tappable(tree, STRINGS.waveActionLabel)).toBeDefined();
    expect(visibleText(tree)).toContain(STRINGS.waveCta(MATE_NAME));
  });

  it('(a) a 42501 speaks the same sentence once the re-read confirms the row', async () => {
    mockState.coverThrows = RLS_REFUSAL;
    mockState.completionExists = true;
    await render();
    await submit();

    // AGAINST HEAD: `something went wrong — try again`. This is the path
    // that actually fires in the app; 23505 needs a millisecond race.
    expect(openDialog(tree)?.props.message).toBe(STRINGS.coverAlreadyCoveredError);
    expect(mockHasCompletionFor).toHaveBeenCalledWith(CIRCLE, MATE, MISSED);
    expect(visibleText(tree)).toContain(STRINGS.waveCta(MATE_NAME));
  });

  it('(a) a 42501 with NO completion there keeps the generic fallback — green both sides, and that is the point', async () => {
    mockState.coverThrows = RLS_REFUSAL;
    mockState.completionExists = false;
    await render();
    await submit();

    // The COPY half is not a discriminator: HEAD says this too, and that
    // is exactly what makes it the guard against "someone already covered
    // them" being claimed for a rolled-over date, a lapsed membership or a
    // self-cover, all of which are also 42501. The re-read count below IS
    // a discriminator — HEAD never makes the call.
    expect(openDialog(tree)?.props.message).toBe('something went wrong — try again');
    expect(mockHasCompletionFor).toHaveBeenCalledTimes(1);
    // No false claim, and no wave primed off the back of one.
    expect(visibleText(tree)).toContain(STRINGS.coverCta(MATE_NAME));
  });

  it('(a) with NO missed day in the params, a 42501 never re-reads and never claims', async () => {
    // FOUND WHILE BUILDING THIS BRANCH, not hypothesised. Without the
    // param the cover write falls back to TODAY, which RLS refuses as
    // 42501 for being the wrong day — and a re-read of TODAY would find
    // the member's OWN check-in and announce that somebody covered them.
    // The pill always sends the param; a stale deep link need not.
    mockState.missedDate = undefined;
    mockState.coverThrows = RLS_REFUSAL;
    mockState.completionExists = true;
    await render();
    await submit();

    expect(mockHasCompletionFor).not.toHaveBeenCalled();
    expect(openDialog(tree)?.props.message).toBe('something went wrong — try again');
  });

  it('(a) a re-read that itself fails claims nothing', async () => {
    mockState.coverThrows = RLS_REFUSAL;
    mockState.completionReadThrows = true;
    await render();
    await submit();

    expect(openDialog(tree)?.props.message).toBe('something went wrong — try again');
  });

  it('(a) waves off drops the wave clause, verbatim — never a gesture that is not there', async () => {
    mockState.coverThrows = DUPLICATE;
    mockState.nudgeAllowed = false;
    await render();
    // FF2's conservative ruling really has hidden the wave.
    expect(tappable(tree, STRINGS.waveActionLabel)).toBeUndefined();

    await submit();

    // AGAINST HEAD: `something went wrong — try again`.
    expect(openDialog(tree)?.props.message).toBe(STRINGS.coverAlreadyCoveredNoWaveError);
    // The dropped clause is the ONLY difference between the two sentences.
    expect(STRINGS.coverAlreadyCoveredNoWaveError).not.toContain('wave');
    expect(STRINGS.coverAlreadyCoveredError).toContain('send them a wave here');
  });

  // ── job 3(b) — the honesty line at the tap ──────────────────────────

  it('(b) past capacity, the screen says what this cover will be BEFORE the tap', async () => {
    mockState.coverWillHold = 'false';
    await render();

    // AGAINST HEAD: nothing renders — the param is not read and the line
    // does not exist. It must be on screen BEFORE any tap, which is the
    // whole ruling: honesty at the decision point.
    expect(visibleText(tree)).toContain(STRINGS.coverWontHoldNote);
    expect(mockCoverMember).not.toHaveBeenCalled();
    // The offer stays WIDE (Cat's Option B) — the cover is still there to
    // send, and still primed. The line informs; it never withdraws.
    expect(visibleText(tree)).toContain(STRINGS.coverCta(MATE_NAME));
  });

  it('(b) the line belongs to the cover, not to the wave', async () => {
    mockState.coverWillHold = 'false';
    await render();
    expect(visibleText(tree)).toContain(STRINGS.coverWontHoldNote);

    await act(async () => {
      tappable(tree, STRINGS.waveActionLabel)!.props.onPress();
    });
    await settle();

    // A wave is untouched by shelter capacity, so the line goes with the
    // cover it was about.
    expect(visibleText(tree)).not.toContain(STRINGS.coverWontHoldNote);
  });

  // ── job 3(c) — the negative control ─────────────────────────────────

  it('(c) NEGATIVE CONTROL: a within-capacity cover shows no line and the plain flow is unchanged — green both sides, said so', async () => {
    mockState.coverWillHold = 'true';
    await render();
    expect(visibleText(tree)).not.toContain(STRINGS.coverWontHoldNote);

    await submit();
    await settle(200);

    // The whole ordinary path, end to end: the write lands on the MISSED
    // day, nothing is said, and the screen goes back to the circle.
    expect(mockCoverMember).toHaveBeenCalledTimes(1);
    expect(mockCoverMember).toHaveBeenCalledWith(CIRCLE, MATE, ME, MISSED);
    expect(openDialog(tree)).toBeUndefined();
    expect(mockHasCompletionFor).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/circle', params: { circleId: CIRCLE } });
  });

  it('(c) an ABSENT flag is silence, not a claim — the unknown reads as today', async () => {
    mockState.coverWillHold = undefined;
    await render();

    // A circle screen still in memory from before this OTA sends no param
    // at all. Silence is the conservative direction (FF2), and it is also
    // exactly HEAD's behaviour — so this is green both sides by design.
    expect(visibleText(tree)).not.toContain(STRINGS.coverWontHoldNote);
    expect(visibleText(tree)).toContain(STRINGS.coverCta(MATE_NAME));
  });
});
