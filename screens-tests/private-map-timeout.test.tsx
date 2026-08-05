/**
 * HY1 job 7 — THE PRIVATE MAP'S TIMEOUT STATE, which did not previously
 * exist as a state at all.
 *
 * WHAT WAS ACTUALLY WRONG, re-verified at HEAD before this was written:
 * the screen's `load` HAS always been wrapped in try/catch/finally
 * (private-map.tsx), so the screen itself never leaked a rejection. What
 * it had was one sentence for every kind of failure — "your map couldn't
 * load just now — give it a moment and try again" — on a screen with
 * nothing to tap. `load` runs from `useFocusEffect`, so "try again"
 * literally meant navigating away and back, and a person on bad signal
 * had no way to know that. SUP1's 15s deadline is the failure most likely
 * to come good on a second attempt, which is what makes offering one
 * honest here rather than a button into the same wall.
 *
 * These pin the three things a refactor could quietly undo: the timeout
 * gets its OWN line, the retry re-runs the real load, and the failure is
 * reported with a `handled` tag (the tag is how a future triage tells
 * "the screen caught this and said so" apart from Sentry c726f818's
 * unhandled rejection).
 *
 * NOT co-located under app/ — see screens-tests/today.test.tsx's note:
 * anything inside a Tabs group becomes a live TAB on the real tab bar.
 */
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { STRINGS } from '@/constants/strings';
import { REQUEST_TIMEOUT_MS } from '@/lib/fetch-timeout';
import { captureError } from '@/lib/sentry';

const USER = '8174d14d-01d4-4371-8b3e-c0647ce2f23f';

/** Exactly what a timed-out PostgREST read hands a screen: postgrest-js
 * catches the fetch rejection and RESOLVES with `{ error }`, and lib/'s
 * readers then `throw error` — a plain object, no `name`. */
const POSTGREST_TIMEOUT = {
  message: `AbortError: Supabase request timed out after ${REQUEST_TIMEOUT_MS}ms`,
  details: '',
  hint: 'Request was aborted (timeout or manual cancellation)',
  code: '',
};

const mockGetMyBlueprint = jest.fn();

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

jest.mock('@/lib/blueprint', () => ({
  ...jest.requireActual('@/lib/blueprint'),
  getMyBlueprint: () => mockGetMyBlueprint(),
  getMyBlueprintResponses: jest.fn(async () => []),
  getMyBlueprintDocument: jest.fn(async () => ({ traits: [], evolution: [], want: null })),
  getWantActivation: jest.fn(async () => null),
  markBlueprintPatternSurfaced: jest.fn(async () => {}),
}));

jest.mock('@/lib/profile', () => ({
  ...jest.requireActual('@/lib/profile'),
  getMyProfile: jest.fn(async () => ({ id: USER, reflections_opt_out: false })),
  setReflectionsOptOut: jest.fn(async () => {}),
}));

jest.mock('@/lib/shareCards', () => ({
  ...jest.requireActual('@/lib/shareCards'),
  getMyLikedCards: jest.fn(async () => []),
  unlikeCard: jest.fn(async () => {}),
}));

jest.mock('@/lib/glow', () => ({
  ...jest.requireActual('@/lib/glow'),
  getMyWeek: jest.fn(async () => []),
}));

jest.mock('@/lib/circle', () => ({
  ...jest.requireActual('@/lib/circle'),
  listMyCircles: jest.fn(async () => []),
  getCircleById: jest.fn(async () => null),
}));

function visibleText(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((c): c is string => typeof c === 'string');
}

async function renderMap() {
  // Required, not imported at module scope, so the fixtures above are
  // initialised before the mock factories run.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PrivateMap = require('@/app/(app)/(tabs)/private-map').default as React.ComponentType;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(React.createElement(PrivateMap));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return tree;
}

beforeEach(() => {
  (captureError as jest.Mock).mockClear();
  mockGetMyBlueprint.mockReset();
});

describe('the private map when a load times out', () => {
  it('says the connection is slow — not "couldn’t load", which blames the app', () => {
    // Pinned as a pair: the timeout line must be present AND the generic
    // one absent, or a refactor that reaches the catch by a different
    // route passes on the first assertion alone.
    expect(STRINGS.loadTimedOutLine('your map')).not.toEqual(STRINGS.loadFailedLine('your map'));
  });

  it('renders the timeout line and a way back', async () => {
    mockGetMyBlueprint.mockRejectedValue(POSTGREST_TIMEOUT);
    const tree = await renderMap();

    const texts = visibleText(tree);
    expect(texts).toContain(STRINGS.loadTimedOutLine('your map'));
    expect(texts).not.toContain(STRINGS.loadFailedLine('your map'));
    expect(texts).toContain(STRINGS.retryCta);

    act(() => tree.unmount());
  });

  it('reports it with a handled tag — the difference from c726f818', async () => {
    mockGetMyBlueprint.mockRejectedValue(POSTGREST_TIMEOUT);
    const tree = await renderMap();

    const call = (captureError as jest.Mock).mock.calls.find(
      ([, tags]) => tags?.screen === 'private-map' && tags?.op === 'load'
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ handled: 'yes', timeout: 'yes' });

    act(() => tree.unmount());
  });

  it('the retry re-runs the real load, and a map that comes back is shown', async () => {
    // THE POINT OF THE AFFORDANCE. A retry that only cleared the message
    // would look identical on the first tap and leave the screen empty.
    mockGetMyBlueprint.mockRejectedValueOnce(POSTGREST_TIMEOUT).mockResolvedValue([]);
    const tree = await renderMap();
    expect(visibleText(tree)).toContain(STRINGS.retryCta);
    expect(mockGetMyBlueprint).toHaveBeenCalledTimes(1);

    const retry = tree.root
      .findAllByType(TouchableOpacity)
      .find((n) =>
        n
          .findAllByType(Text)
          .some((t) => t.props.children === STRINGS.retryCta)
      );
    expect(retry).toBeDefined();

    await act(async () => {
      retry!.props.onPress();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockGetMyBlueprint).toHaveBeenCalledTimes(2);
    expect(visibleText(tree)).not.toContain(STRINGS.loadTimedOutLine('your map'));

    act(() => tree.unmount());
  });

  it('an ORDINARY failure keeps the generic line and offers no false promise of a timeout', async () => {
    mockGetMyBlueprint.mockRejectedValue(new Error('permission denied for table blueprint_patterns'));
    const tree = await renderMap();

    const texts = visibleText(tree);
    expect(texts).toContain(STRINGS.loadFailedLine('your map'));
    expect(texts).not.toContain(STRINGS.loadTimedOutLine('your map'));
    // Still reported, still handled — just not tagged as a timeout.
    const call = (captureError as jest.Mock).mock.calls.find(
      ([, tags]) => tags?.screen === 'private-map' && tags?.op === 'load'
    );
    expect(call![1]).toMatchObject({ handled: 'yes' });
    expect(call![1]).not.toHaveProperty('timeout');

    act(() => tree.unmount());
  });
});
