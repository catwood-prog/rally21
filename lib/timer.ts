import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * T1 (8 July) — the check-in timer's deadline math and cross-refresh
 * persistence, pulled out of checkin-timer.tsx so the pure pieces are
 * unit-testable. The countdown itself was already deriving `remaining`
 * from a wall-clock timestamp rather than accumulated ticks (verified by
 * reading the existing code before this pass) — the gap T1 closes is
 * that timestamp never survived an accidental same-tab refresh, since a
 * plain useState initializer re-runs on every fresh mount. Persisting the
 * deadline (keyed per circle AND local date, so a stale abandoned sit
 * from a previous day never resurfaces as "still counting") is what
 * makes a refresh resume instead of reset.
 */

/** The wall-clock instant a countdown of `totalSeconds` starting `now`
 * will end. */
export function computeEndsAt(now: number, totalSeconds: number): number {
  return now + totalSeconds * 1000;
}

/** Seconds left until `endsAt`, never negative. */
export function remainingSeconds(endsAt: number, now: number): number {
  return Math.max(0, (endsAt - now) / 1000);
}

/** Whether the deadline has already passed. */
export function hasEnded(endsAt: number, now: number): boolean {
  return now >= endsAt;
}

/** Scoped to circle + local date (not just circle) — a sit abandoned
 * yesterday and never marked done must never resurface as "still
 * running" (or worse, "just ended, it still counts") when the user opens
 * a fresh check-in for the same circle today. */
export function timerStorageKey(circleId: string, localDate: string): string {
  return `rally21:timer:${circleId}:${localDate}`;
}

export type PersistedTimerState = { endsAt: number; totalSeconds: number };

function isPersistedTimerState(value: unknown): value is PersistedTimerState {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as PersistedTimerState).endsAt === 'number' &&
    typeof (value as PersistedTimerState).totalSeconds === 'number'
  );
}

/** Best-effort read — any failure (unsupported storage, corrupt JSON)
 * just means the caller falls back to starting a fresh countdown, same
 * as today's behavior. */
export async function loadPersistedTimer(key: string): Promise<PersistedTimerState | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPersistedTimerState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Best-effort write — a failure here just means a later refresh resets
 * instead of resumes, the same gap this whole module exists to close,
 * never a thrown error interrupting the sit itself. */
export async function savePersistedTimer(key: string, state: PersistedTimerState): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(state));
  } catch {
    // best-effort
  }
}

export async function clearPersistedTimer(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // best-effort — a leftover stale entry is harmless, timerStorageKey's
    // own local-date scoping already keeps it from resurfacing on a
    // later day
  }
}

/** BR1 (16 July) — whether this device has turned the breathing pacer
 * off ("just the timer"). Per-device by design (Cat's ruling), so it's
 * plain AsyncStorage like the deadline above, not a profile flag. On by
 * default: only the OFF choice is ever stored, and any read failure just
 * means the pacer shows. */
const PACER_OFF_KEY = 'rally21:timer:pacerOff';

export async function loadBreathingPacerOff(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PACER_OFF_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function saveBreathingPacerOff(off: boolean): Promise<void> {
  try {
    if (off) {
      await AsyncStorage.setItem(PACER_OFF_KEY, '1');
    } else {
      await AsyncStorage.removeItem(PACER_OFF_KEY);
    }
  } catch {
    // best-effort — worst case the preference doesn't stick this time
  }
}
