import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearPersistedTimer,
  computeEndsAt,
  hasEnded,
  loadPersistedTimer,
  PersistedTimerState,
  remainingSeconds,
  savePersistedTimer,
  timerStorageKey,
} from './timer';

describe('computeEndsAt / remainingSeconds / hasEnded — pure deadline math', () => {
  it('computeEndsAt adds totalSeconds (in ms) to the given instant', () => {
    expect(computeEndsAt(1_000, 60)).toBe(1_000 + 60_000);
  });

  it('remainingSeconds counts down linearly toward the deadline', () => {
    const endsAt = computeEndsAt(0, 300); // 5 minutes
    expect(remainingSeconds(endsAt, 0)).toBe(300);
    expect(remainingSeconds(endsAt, 150_000)).toBe(150);
    expect(remainingSeconds(endsAt, 300_000)).toBe(0);
  });

  it('remainingSeconds never goes negative once the deadline has passed', () => {
    const endsAt = computeEndsAt(0, 60);
    expect(remainingSeconds(endsAt, 120_000)).toBe(0);
  });

  it('is driven purely by the wall-clock gap, not accumulated ticks — a huge elapsed jump (e.g. a throttled/backgrounded tab) still lands on the correct value', () => {
    const endsAt = computeEndsAt(0, 60);
    // Simulates a tab backgrounded for far longer than the sit itself —
    // no intermediate "ticks" were ever computed, yet the result is exact.
    expect(remainingSeconds(endsAt, 45_000)).toBe(15);
  });

  it('hasEnded is false right up to the deadline and true from it onward', () => {
    const endsAt = computeEndsAt(0, 60);
    expect(hasEnded(endsAt, 59_999)).toBe(false);
    expect(hasEnded(endsAt, 60_000)).toBe(true);
    expect(hasEnded(endsAt, 60_001)).toBe(true);
  });
});

describe('timerStorageKey — scoped per circle AND local date', () => {
  it('differs across circles for the same date', () => {
    expect(timerStorageKey('circle-a', '2026-07-08')).not.toBe(timerStorageKey('circle-b', '2026-07-08'));
  });

  it('differs across dates for the same circle — a stale abandoned sit from a prior day must never resurface', () => {
    expect(timerStorageKey('circle-a', '2026-07-08')).not.toBe(timerStorageKey('circle-a', '2026-07-09'));
  });

  it('is stable for the same circle + date', () => {
    expect(timerStorageKey('circle-a', '2026-07-08')).toBe(timerStorageKey('circle-a', '2026-07-08'));
  });
});

describe('persisted timer state — real AsyncStorage round-trip', () => {
  const key = timerStorageKey('circle-test', '2026-07-08');

  afterEach(async () => {
    await clearPersistedTimer(key);
  });

  it('save then load returns the exact same state — this is the refresh-resume path', async () => {
    const state: PersistedTimerState = { endsAt: 123_456_789, totalSeconds: 600 };
    await savePersistedTimer(key, state);
    await expect(loadPersistedTimer(key)).resolves.toEqual(state);
  });

  it('load returns null when nothing has been saved for this key', async () => {
    await expect(loadPersistedTimer(key)).resolves.toBeNull();
  });

  it('clear removes a saved entry', async () => {
    await savePersistedTimer(key, { endsAt: 1, totalSeconds: 60 });
    await clearPersistedTimer(key);
    await expect(loadPersistedTimer(key)).resolves.toBeNull();
  });

  it('load treats corrupt/malformed stored JSON as absent rather than throwing', async () => {
    await AsyncStorage.setItem(key, 'not valid json{{{');
    await expect(loadPersistedTimer(key)).resolves.toBeNull();
  });

  it('load treats a validly-parsed but shape-mismatched value as absent', async () => {
    await AsyncStorage.setItem(key, JSON.stringify({ somethingElse: true }));
    await expect(loadPersistedTimer(key)).resolves.toBeNull();
  });
});
