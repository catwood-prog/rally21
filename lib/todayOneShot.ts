// P1 (8 July) — Today's one-shot gestures (the dot strip's fill-pop, the
// header flame's flicker) play once per state change, never per visit.
// A plain in-memory Set is enough: it resets on a full reload, which just
// means a fresh "session" gets to see the one-shot again once — no
// AsyncStorage/server round-trip is worth it for a purely decorative
// flourish. Keyed by local date so a day that's already played never
// replays on a later focus of Today the same day.
const playedDates = new Set<string>();

export function hasPlayedTodayGlowOneShot(localDate: string): boolean {
  return playedDates.has(localDate);
}

export function markTodayGlowOneShotPlayed(localDate: string): void {
  playedDates.add(localDate);
}
