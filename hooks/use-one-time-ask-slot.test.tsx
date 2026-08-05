/**
 * WB1 job 1b — the one-mount cooldown between one-time ask cards.
 *
 * THE BUG BEING PINNED, in Cat's words from the 3 Aug walk: the reminders
 * yes "answered with silence then segued into the photo ask". Mechanically
 * — the photo ask's own gate included "has already seen the reminders
 * ask", so answering the reminders card satisfied it and the next card
 * mounted into the same slot on the same render.
 *
 * These render the REAL hook through a probe component rather than testing
 * a pure function, because the thing that has to hold is a behaviour
 * across renders (a latch), not a calculation.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { OneTimeAsk, useOneTimeAskSlot } from './use-one-time-ask-slot';

// expo-router's useFocusEffect needs a navigation context this probe has
// no reason to build. The release-on-focus path is a separate concern from
// the latch these tests exist to pin, so it is stubbed to a plain mount
// effect — which is exactly what a first focus is.
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // Required lazily so jest's out-of-scope-variable guard allows it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(cb, [cb]);
  },
}));

function Probe({ asks, onSlot }: { asks: OneTimeAsk[]; onSlot: (slot: ReturnType<typeof useOneTimeAskSlot>) => void }) {
  const slot = useOneTimeAskSlot(asks);
  onSlot(slot);
  return <Text>{slot.activeAskId ?? 'none'}</Text>;
}

function renderProbe(asks: OneTimeAsk[]) {
  let latest!: ReturnType<typeof useOneTimeAskSlot>;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Probe asks={asks} onSlot={(s) => (latest = s)} />);
  });
  return {
    tree,
    slot: () => latest,
    rerender: (next: OneTimeAsk[]) =>
      act(() => {
        tree.update(<Probe asks={next} onSlot={(s) => (latest = s)} />);
      }),
  };
}

const NOTHING_ELIGIBLE_YET: OneTimeAsk[] = [
  { id: 'reminders', eligible: false },
  { id: 'photo', eligible: false },
];

describe('the one-time-ask slot', () => {
  it('shows the first eligible ask, in priority order', () => {
    const { slot } = renderProbe([
      { id: 'reminders', eligible: true },
      { id: 'photo', eligible: true },
    ]);
    expect(slot().activeAskId).toBe('reminders');
  });

  it('does NOT reveal the next ask when answering the first one makes it eligible', () => {
    // The live shape of the bug: reminders is eligible, photo is gated on
    // reminders having been seen.
    const { slot, rerender } = renderProbe([
      { id: 'reminders', eligible: true },
      { id: 'photo', eligible: false },
    ]);
    expect(slot().activeAskId).toBe('reminders');

    // The answer lands: the reminders flag flips, which flips the photo
    // ask's gate open in the same render.
    rerender([
      { id: 'reminders', eligible: false },
      { id: 'photo', eligible: true },
    ]);

    // The slot stays with the ask that was answered — which is also what
    // keeps it mounted for WB1 job 1a's confirm.
    expect(slot().activeAskId).toBe('reminders');
  });

  it('shows nothing more this visit once the active ask dismisses itself', () => {
    const { slot, rerender } = renderProbe([
      { id: 'reminders', eligible: true },
      { id: 'photo', eligible: false },
    ]);
    act(() => slot().dismissActive());
    expect(slot().activeAskId).toBeNull();

    // Even with the next ask now fully eligible, a dismissal must not
    // promote it: the cooldown is the point.
    rerender([
      { id: 'reminders', eligible: false },
      { id: 'photo', eligible: true },
    ]);
    expect(slot().activeAskId).toBeNull();
  });

  it('waits for the flags to load rather than latching an empty first render', () => {
    // Every screen using this fetches its flags, so the first render has
    // nothing eligible. Latching THAT would close the slot for the visit.
    const { slot, rerender } = renderProbe(NOTHING_ELIGIBLE_YET);
    expect(slot().activeAskId).toBeNull();

    rerender([
      { id: 'reminders', eligible: true },
      { id: 'photo', eligible: false },
    ]);
    expect(slot().activeAskId).toBe('reminders');
  });

  it('offers the next ask on the NEXT visit', () => {
    // A fresh mount is a fresh visit (and on a tab screen, so is a fresh
    // focus — see the hook). Reminders already answered, photo now due.
    const { slot } = renderProbe([
      { id: 'reminders', eligible: false },
      { id: 'photo', eligible: true },
    ]);
    expect(slot().activeAskId).toBe('photo');
  });
});
