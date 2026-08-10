/**
 * IL3 (10 Aug, from Cat's 9 Aug walk) — AN INVITE LINK MUST DO SOMETHING
 * FOR SOMEONE WHO ALREADY HAS AN ACCOUNT.
 *
 * THE DEFECT THIS PINS. Cat opened `rally21.com/j/ZUG25J` signed out,
 * tapped through, signed in as an existing account, and landed on Today
 * with the circle absent and no membership row written. Every gate that
 * could legitimately have refused was open. Nothing refused; the join
 * simply never happened.
 *
 * `app/j/[code].tsx` saved the code on tap and handed off to /sign-in. Its
 * ONLY reader was `app/onboarding/circle-setup.tsx`, behind a day-zero
 * guard — and an existing account never reaches that screen, because
 * `app/index.tsx` sends a signed-in arrival straight to Today. The code
 * was written to storage and never read, so the link worked ONLY for
 * people who had never used Rally21 and failed SILENTLY for everyone who
 * had. The invite batch went out to people who then signed up, which makes
 * the cohort most likely to tap a link exactly the cohort it could not
 * serve.
 *
 * WHY THIS TEST EXISTS AND `lib/invite-link.test.ts` WAS NOT ENOUGH, and
 * it is the transferable part: those tests cover save and take in
 * ISOLATION and they PASSED throughout. The unit was correct and the ROUTE
 * was broken — a class neither end's unit test can see. So this walks the
 * ARRIVAL: it mounts app/index.tsx as a signed-in existing account, takes
 * the destination index actually chose, and feeds that destination's own
 * params into the join screen. Nothing is asserted about a helper in
 * isolation; the assertion is that the two screens are CONNECTED.
 *
 * NOT co-located under app/ — see screens-tests/today.test.tsx's note: a
 * test file inside app/ is compiled into the production bundle.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

const CODE = 'ZUG25J';
const PENDING_KEY = 'rally21_pending_invite_code';
const EXISTING_USER = '621f2260-bba7-44b4-9e90-b911c434e7b2';

/** What app/index.tsx last redirected to. `mock`-prefixed so the hoisted
 * jest.mock factory below may reference it. */
let mockRedirects: { pathname: string; params: Record<string, string> }[] = [];

/** The onboarding status index.tsx sees. 'ready' is the returning account
 * — a name and at least one circle — which is the whole subject here. */
let mockStatus = 'ready';
let mockSession: { user: { id: string } } | null = { user: { id: EXISTING_USER } };

jest.mock('expo-router', () => ({
  // Redirect renders nothing; it is captured, because the destination IS
  // the behaviour under test.
  Redirect: ({ href }: { href: string | { pathname: string; params?: Record<string, string> } }) => {
    mockRedirects.push(
      typeof href === 'string' ? { pathname: href, params: {} } : { pathname: href.pathname, params: href.params ?? {} }
    );
    return null;
  },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockJoinParams,
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockJoinParams: Record<string, string> = {};

jest.mock('@/lib/auth-context', () => ({ useAuth: () => ({ session: mockSession, isLoading: false }) }));
jest.mock('@/hooks/use-onboarding-status', () => ({
  useOnboardingStatus: () => ({ status: mockStatus, refresh: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

/** WarmOpen is Today's greeting beat, and an ordinary open passes THROUGH
 * it to /today. Stubbed to finish immediately so the ordinary arrival
 * still resolves to a destination this test can read; an invited arrival
 * must never reach it at all. */
jest.mock('@/components/WarmOpen', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require('react');
  return {
    WarmOpen: ({ onDone }: { onDone: () => void }) => {
      useEffect(() => onDone(), [onDone]);
      return null;
    },
  };
});

/** The join screen's two network reads. `joinCircleByCode` is the call
 * whose absence WAS the defect, so it is a spy, not a stub of convenience. */
jest.mock('@/lib/circle-setup', () => ({
  ...jest.requireActual('@/lib/circle-setup'),
  joinCircleByCode: jest.fn(async () => 'circle-id'),
  joinPublicCircle: jest.fn(async () => undefined),
  listPublicCircles: jest.fn(async () => []),
}));

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Mount app/index.tsx — the arrival — and report where it sent this
 * person. This is the half that was broken. */
async function arrive(): Promise<{ tree: ReactTestRenderer; to: { pathname: string; params: Record<string, string> } }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Index = require('@/app/index').default as React.ComponentType;
  mockRedirects = [];
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(React.createElement(Index));
  });
  await flush();
  return { tree, to: mockRedirects[mockRedirects.length - 1] };
}

/** Mount the join screen with the params index CHOSE, then press join.
 * Taking the params from `to` rather than writing them out again is the
 * point: a test that hand-feeds the code proves the screen works and says
 * nothing about whether anything ever hands it one. */
async function landOnJoinScreen(to: { params: Record<string, string> }) {
  mockJoinParams = to.params;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JoinCircle = require('@/app/onboarding/join-circle').default as React.ComponentType;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(React.createElement(JoinCircle));
  });
  await flush();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextInput, TouchableOpacity, Text } = require('react-native');
  const field = tree.root.findAllByType(TextInput).find((n) => n.props.maxLength === 6);
  const pressJoin = async () => {
    const button = tree.root
      .findAllByType(TouchableOpacity)
      .find((n) =>
        n.findAllByType(Text).some((t) => t.props.children === 'join circle')
      );
    await act(async () => {
      button?.props.onPress();
    });
    await flush();
  };
  return { tree, prefill: field?.props.value as string | undefined, pressJoin };
}

beforeEach(async () => {
  jest.clearAllMocks();
  // Deliberately NO jest.resetModules(): it hands the require()d screens a
  // second copy of React and every mount dies on "Invalid hook call". The
  // per-case state below is the `mock*` module variables, reset by hand.
  await AsyncStorage.clear();
  mockRedirects = [];
  mockJoinParams = {};
  mockStatus = 'ready';
  mockSession = { user: { id: EXISTING_USER } };
});

describe('the invite arrival, as an account that already exists (IL3)', () => {
  it("CAT'S WALK, fixed: a fresh code taps through to the join screen and the join is attempted", async () => {
    // Exactly what /j/<code> leaves behind when someone taps it signed out.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { savePendingInviteCode } = require('@/lib/invite-link');
    await savePendingInviteCode(CODE);

    const { tree, to } = await arrive();

    // The arrival, which on the pre-fix build was '/today' and nothing else.
    expect(to.pathname).toBe('/onboarding/join-circle');
    expect(to.params.code).toBe(CODE);
    act(() => tree.unmount());

    // And the destination index chose actually carries the join through.
    const join = await landOnJoinScreen(to);
    expect(join.prefill).toBe(CODE);
    await join.pressJoin();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { joinCircleByCode } = require('@/lib/circle-setup');
    expect(joinCircleByCode).toHaveBeenCalledWith(CODE);
    act(() => join.tree.unmount());
  });

  it('backs out to Today, not to the setup fork a returning account has no business seeing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { savePendingInviteCode } = require('@/lib/invite-link');
    await savePendingInviteCode(CODE);
    const { tree, to } = await arrive();
    expect(to.params.fromToday).toBe('true');
    act(() => tree.unmount());
  });

  it('a code older than the freshness window does NOT steer this visit', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PENDING_CODE_FRESH_MS } = require('@/lib/invite-link');
    await AsyncStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ code: CODE, savedAt: Date.now() - (PENDING_CODE_FRESH_MS + 60_000) })
    );

    const { tree, to } = await arrive();

    expect(to.pathname).toBe('/today');
    // And it is gone, rather than waiting to be re-tested on every open.
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
    act(() => tree.unmount());
  });

  it('an ordinary open with no code is untouched — straight to Today', async () => {
    const { tree, to } = await arrive();
    expect(to.pathname).toBe('/today');
    act(() => tree.unmount());
  });

  it('fires ONCE: the second arrival is an ordinary open', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { savePendingInviteCode } = require('@/lib/invite-link');
    await savePendingInviteCode(CODE);

    const first = await arrive();
    expect(first.to.pathname).toBe('/onboarding/join-circle');
    act(() => first.tree.unmount());

    const second = await arrive();
    expect(second.to.pathname).toBe('/today');
    act(() => second.tree.unmount());
  });

  it('does NOT eat a cold arrival’s code — a half-finished signup keeps it for the fork', async () => {
    // The reason index is not the only reader: profile.tsx replaces
    // straight to circle-setup and never comes back through "/", so a code
    // consumed here would strand every brand-new signup instead.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { savePendingInviteCode } = require('@/lib/invite-link');
    await savePendingInviteCode(CODE);
    mockStatus = 'needs-profile';

    const { tree, to } = await arrive();

    expect(to.pathname).toBe('/onboarding/profile');
    expect(await AsyncStorage.getItem(PENDING_KEY)).not.toBeNull();
    act(() => tree.unmount());
  });

  it('leaves the code alone at the setup fork too, where circle-setup reads it', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { savePendingInviteCode } = require('@/lib/invite-link');
    await savePendingInviteCode(CODE);
    mockStatus = 'needs-circle';

    const { tree, to } = await arrive();

    expect(to.pathname).toBe('/onboarding/circle-setup');
    expect(await AsyncStorage.getItem(PENDING_KEY)).not.toBeNull();
    act(() => tree.unmount());
  });

  it('a signed-out arrival reads no storage at all', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { savePendingInviteCode } = require('@/lib/invite-link');
    await savePendingInviteCode(CODE);
    mockSession = null;
    mockStatus = 'loading';

    const { tree, to } = await arrive();

    expect(to.pathname).toBe('/splash');
    expect(await AsyncStorage.getItem(PENDING_KEY)).not.toBeNull();
    act(() => tree.unmount());
  });
});
