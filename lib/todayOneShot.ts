// P1 (8 July) / BD2 (8 July) — Today's one-shot surfaces (the glow dot
// strip's fill-pop + header flame flicker, and the birthday moment's
// entrance/confetti/gesture) each play once per local date, never per
// visit. A plain in-memory Set is enough: it resets on a full reload,
// which just means a fresh "session" gets to see the one-shot again once
// — no AsyncStorage/server round-trip is worth it for a purely
// decorative flourish. Generalized to a `kind` (BD2 is this module's
// second caller) so a birthday and a glow one-shot on the SAME day are
// tracked independently rather than colliding on a shared key.
export type OneShotKind = 'glow' | 'birthday';

const playedKeys = new Set<string>();

function key(kind: OneShotKind, localDate: string): string {
  return `${kind}:${localDate}`;
}

export function hasPlayedTodayOneShot(kind: OneShotKind, localDate: string): boolean {
  return playedKeys.has(key(kind, localDate));
}

export function markTodayOneShotPlayed(kind: OneShotKind, localDate: string): void {
  playedKeys.add(key(kind, localDate));
}
