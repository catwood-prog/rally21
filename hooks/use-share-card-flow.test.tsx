/**
 * HY1 job 4 (R5) — the share flow, once, for both screens.
 *
 * THE THING WORTH PINNING is the fallback: `shareCardImage` returning
 * FALSE is not a failure, it means no share sheet was presented, and
 * share-cards spec §6 says that path ends in a download recorded as
 * 'saved'. That distinction is exactly what a second hand-typed copy
 * loses, which is why the composition was extracted at all.
 *
 * These drive the REAL hook through a probe component, because what has
 * to hold is a sequence across renders (in-flight flag on, work, flag
 * off), not a calculation.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';

import { useShareCardFlow } from './use-share-card-flow';

// `mock`-prefixed so jest's out-of-scope-variable guard allows the
// factories below to close over them.
const mockCaptureShareCard = jest.fn();
const mockShareCardImage = jest.fn();
const mockSaveCardImage = jest.fn();
const mockRecordCardEvent = jest.fn();

jest.mock('@/lib/shareCardExport', () => ({
  captureShareCard: (...a: unknown[]) => mockCaptureShareCard(...a),
  shareCardImage: (...a: unknown[]) => mockShareCardImage(...a),
  saveCardImage: (...a: unknown[]) => mockSaveCardImage(...a),
}));

jest.mock('@/lib/shareCards', () => ({
  recordCardEvent: (...a: unknown[]) => mockRecordCardEvent(...a),
}));

type Flow = ReturnType<typeof useShareCardFlow>;

function renderFlow(overrides: { onError?: (m: string) => void; onResolved?: () => void; cardKey?: string | undefined } = {}) {
  const cardRef = { current: null };
  let latest!: Flow;
  function Probe() {
    latest = useShareCardFlow({
      flavor: 'curated_quote',
      cardKey: 'cardKey' in overrides ? overrides.cardKey : 'quote-7',
      cardRef,
      onError: overrides.onError ?? jest.fn(),
      onResolved: overrides.onResolved,
    });
    return <Text>{latest.isSharing ? 'sharing' : 'idle'}</Text>;
  }
  act(() => {
    create(<Probe />);
  });
  return { flow: () => latest };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCaptureShareCard.mockResolvedValue('file:///card.png');
  mockRecordCardEvent.mockResolvedValue(undefined);
  mockSaveCardImage.mockResolvedValue(undefined);
});

test('a real share sheet records "shared" and never saves a second copy', async () => {
  mockShareCardImage.mockResolvedValue(true);
  const onResolved = jest.fn();
  const { flow } = renderFlow({ onResolved });

  await act(async () => {
    await flow().share();
  });

  expect(mockCaptureShareCard).toHaveBeenCalledWith({ current: null });
  expect(mockSaveCardImage).not.toHaveBeenCalled();
  expect(mockRecordCardEvent).toHaveBeenCalledWith('curated_quote', 'quote-7', 'shared');
  expect(onResolved).toHaveBeenCalledTimes(1);
  expect(flow().isSharing).toBe(false);
});

test('NO share sheet falls back to a save — the card still leaves, recorded as "saved"', async () => {
  // The regression this guards: a screen re-implementing the flow and
  // treating `false` as an error removes the only way a web user without
  // navigator.share can keep their card.
  mockShareCardImage.mockResolvedValue(false);
  const onError = jest.fn();
  const onResolved = jest.fn();
  const { flow } = renderFlow({ onError, onResolved });

  await act(async () => {
    await flow().share();
  });

  expect(mockSaveCardImage).toHaveBeenCalledWith('file:///card.png');
  expect(mockRecordCardEvent).toHaveBeenCalledWith('curated_quote', 'quote-7', 'saved');
  expect(mockRecordCardEvent).not.toHaveBeenCalledWith('curated_quote', 'quote-7', 'shared');
  expect(onError).not.toHaveBeenCalled();
  expect(onResolved).toHaveBeenCalledTimes(1);
});

test('a failed capture gets the warm line, records nothing, and resolves nothing', async () => {
  mockCaptureShareCard.mockRejectedValue(new Error('capture ref is empty'));
  const onError = jest.fn();
  const onResolved = jest.fn();
  const { flow } = renderFlow({ onError, onResolved });

  await act(async () => {
    await flow().share();
  });

  expect(onError).toHaveBeenCalledTimes(1);
  // ER1/warmth law: a warm line, never the raw message.
  expect(onError.mock.calls[0][0]).not.toContain('capture ref is empty');
  expect(mockRecordCardEvent).not.toHaveBeenCalled();
  expect(onResolved).not.toHaveBeenCalled();
  expect(flow().isSharing).toBe(false);
});

test('a lost card_events write never costs the user their share', async () => {
  // FF1 rule 1, stated as a test: the event is best-effort telemetry and
  // the image has already left the app — a rejected write must not
  // surface as "the share failed".
  mockShareCardImage.mockResolvedValue(true);
  mockRecordCardEvent.mockRejectedValue(new Error('network'));
  const onError = jest.fn();
  const onResolved = jest.fn();
  const { flow } = renderFlow({ onError, onResolved });

  await act(async () => {
    await flow().share();
  });

  expect(onError).not.toHaveBeenCalled();
  expect(onResolved).toHaveBeenCalledTimes(1);
});

test('no cardKey yet is a no-op — never an event with no subject', async () => {
  const { flow } = renderFlow({ cardKey: undefined });

  await act(async () => {
    await flow().share();
  });

  expect(mockCaptureShareCard).not.toHaveBeenCalled();
  expect(mockRecordCardEvent).not.toHaveBeenCalled();
});
