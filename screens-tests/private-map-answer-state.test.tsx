/**
 * BP1 — THE PRIVATE MAP'S ANSWERED CARD, which never noticed it had been
 * answered.
 *
 * WHAT WAS ACTUALLY WRONG, measured from the rows before this was written:
 * `blueprint_responses` held SEVEN `confirmed` rows for one pattern, all
 * for one person, all inside eleven seconds. Every tap landed. The screen
 * chose its active card by KEY alone and never consulted the responses,
 * while the confirmed list took anything answered `confirmed` — two
 * filters written as though exclusive. So the instant the first answer
 * landed, the pattern satisfied BOTH: it rendered as the active card WITH
 * LIVE BUTTONS and again below as "you said this sounds right". A second
 * copy instead of a resolved card reads as nothing having happened, so she
 * tapped again. And again.
 *
 * These pin the render half. The write half — one row per (person,
 * pattern), last answer wins — is pinned in
 * supabase/blueprint-responses.integration.test.ts against the real unique
 * constraint and the real RLS.
 *
 * THE TWO ASSERTIONS IN THE SECOND TEST MATTER AS A PAIR: "renders once"
 * alone would pass on a screen that dropped the answered card entirely,
 * and "no live buttons" alone would pass on a screen still rendering two
 * copies with both sets disabled.
 *
 * NOT co-located under app/ — see screens-tests/today.test.tsx's note:
 * anything inside a Tabs group becomes a live TAB on the real tab bar.
 */
import React from 'react';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import { STRINGS } from '@/constants/strings';
import type { BlueprintPattern } from '@/lib/blueprint';

const USER = '8174d14d-01d4-4371-8b3e-c0647ce2f23f';

/** `mock`-prefixed so jest's factory hoisting allows the reference below. */
const mockConsistencyPattern: BlueprintPattern = {
  patternKey: 'consistency',
  patternType: 'consistency',
  weekday: null,
  direction: null,
  cutoffHour: 9,
  agreementCount: 5,
  totalCount: 6,
  evidenceRate: 0.83,
  statement: null,
  contrast: null,
};

const mockRespond = jest.fn(async (_params: unknown) => {});

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
  getMyBlueprint: jest.fn(async () => [mockConsistencyPattern]),
  getMyBlueprintResponses: jest.fn(async () => []),
  getMyBlueprintDocument: jest.fn(async () => ({ traits: [], evolution: [], want: null })),
  getWantActivation: jest.fn(async () => null),
  markBlueprintPatternSurfaced: jest.fn(async () => {}),
  respondToBlueprintPattern: mockRespond,
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

function occurrences(texts: string[], needle: string): number {
  return texts.filter((t) => t === needle).length;
}

/** Every tappable carrying this exact label. The COUNT is the point: a
 * button still on the screen after an answer is a button that can write
 * another row. */
function tappablesLabelled(tree: ReactTestRenderer, label: string) {
  return tree.root
    .findAllByType(TouchableOpacity)
    .filter((n) => n.findAllByType(Text).some((t) => t.props.children === label));
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

async function tap(node: ReactTestInstance) {
  await act(async () => {
    (node.props.onPress as () => void)();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockRespond.mockClear();
});

describe('the private map after a pattern is answered', () => {
  it('starts with exactly one card and a live "sounds right" to tap', async () => {
    const tree = await renderMap();
    expect(occurrences(visibleText(tree), STRINGS.blueprintPatternLabel)).toBe(1);
    expect(tappablesLabelled(tree, STRINGS.blueprintSoundsRight).length).toBe(1);
    act(() => tree.unmount());
  });

  it('renders ONCE, answered, with no live buttons left', async () => {
    const tree = await renderMap();

    await tap(tappablesLabelled(tree, STRINGS.blueprintSoundsRight)[0]);

    const texts = visibleText(tree);
    // One card, not two. This is what "the same insight appeared twice"
    // actually was.
    expect(occurrences(texts, STRINGS.blueprintPatternLabel)).toBe(1);
    expect(texts).toContain(STRINGS.blueprintConfirmedText);
    // And nothing left to tap a second time.
    expect(tappablesLabelled(tree, STRINGS.blueprintSoundsRight).length).toBe(0);
    expect(tappablesLabelled(tree, STRINGS.blueprintNotQuite).length).toBe(0);

    act(() => tree.unmount());
  });

  it('a second tap is not reachable, so a second write cannot happen', async () => {
    const tree = await renderMap();

    await tap(tappablesLabelled(tree, STRINGS.blueprintSoundsRight)[0]);
    expect(mockRespond).toHaveBeenCalledTimes(1);

    // She tapped the button she could still see. Re-QUERIED from the live
    // tree rather than re-firing the stale handle, because that is what a
    // finger does.
    expect(tappablesLabelled(tree, STRINGS.blueprintSoundsRight).length).toBe(0);
    expect(mockRespond).toHaveBeenCalledTimes(1);

    act(() => tree.unmount());
  });

  it('a not_quite answer resolves the card too, and carries its note', async () => {
    const tree = await renderMap();

    await tap(tappablesLabelled(tree, STRINGS.blueprintNotQuite)[0]);
    const input = tree.root.findAllByType(TextInput)[0];
    await act(async () => {
      input.props.onChangeText('it’s actually after work');
    });
    await tap(tappablesLabelled(tree, STRINGS.blueprintNoteSubmit)[0]);

    expect(mockRespond).toHaveBeenCalledWith(
      expect.objectContaining({
        patternKey: 'consistency',
        response: 'not_quite',
        note: 'it’s actually after work',
      })
    );
    // No answered card for a not_quite: the pattern is simply gone, which
    // is also what the next load does (get_my_blueprint excludes a
    // not_quite pattern outright).
    expect(occurrences(visibleText(tree), STRINGS.blueprintPatternLabel)).toBe(0);
    expect(tappablesLabelled(tree, STRINGS.blueprintSoundsRight).length).toBe(0);

    act(() => tree.unmount());
  });

  it('a FAILED save leaves the buttons live — the card resolves on a real write only', async () => {
    mockRespond.mockRejectedValueOnce(new Error('network'));
    const tree = await renderMap();

    await tap(tappablesLabelled(tree, STRINGS.blueprintSoundsRight)[0]);

    expect(occurrences(visibleText(tree), STRINGS.blueprintConfirmedText)).toBe(0);
    expect(tappablesLabelled(tree, STRINGS.blueprintSoundsRight).length).toBe(1);

    act(() => tree.unmount());
  });
});
