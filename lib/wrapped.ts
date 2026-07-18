// SC3 (18 July) — the day-21 mini-Wrapped's data layer
// (Rally21-Share-Cards-Spec.md §4.5). Pure composition over the same
// sources the app already trusts: the dot states come from
// getCirclePresence rows (completions — the exact rows Who's Here, the
// SignalMeter and the glow math read), and the counts are derived from
// those same dots, so the card can never show an invented number.

import { PresenceKind } from './circle';
import { shiftDate } from './date';

export type WrappedDotState = 'earned' | 'held' | 'none';

export type WrappedData = {
  /** One state per journey day, day 1 first — length = milestone. */
  dots: WrappedDotState[];
  /** Days with a SELF completion — "showed up N days". */
  shownUp: number;
  /** Days a friend held the place (covered) — never counted as shown up. */
  held: number;
};

/**
 * Compose the Wrapped card's dots + counts for one member of one circle.
 * `presence` is getCirclePresence's result (every member's rows — the
 * caller's own rows are filtered here by userId). Days after `today`
 * (a ceremony opened early never happens, but a backdated fixture
 * might) count as 'none' like any other quiet day. Warmth law: the
 * output carries only what HAPPENED — the render layer never counts
 * misses.
 */
export function composeWrappedData(params: {
  userId: string;
  circleStartDate: string;
  milestoneDay: number;
  presence: { userId: string; localDate: string; kind: PresenceKind }[];
}): WrappedData {
  const mine = new Map<string, PresenceKind>();
  for (const row of params.presence) {
    if (row.userId !== params.userId) continue;
    // A self completion always wins over a covered row on the same day
    // (both can exist if a cover landed before an own check-in).
    const existing = mine.get(row.localDate);
    if (existing === 'self') continue;
    mine.set(row.localDate, row.kind === 'self' ? 'self' : existing === undefined ? 'covered' : existing);
  }

  const dots: WrappedDotState[] = [];
  let shownUp = 0;
  let held = 0;
  for (let i = 0; i < params.milestoneDay; i++) {
    const date = shiftDate(params.circleStartDate, i);
    const kind = mine.get(date);
    if (kind === 'self') {
      dots.push('earned');
      shownUp++;
    } else if (kind === 'covered') {
      dots.push('held');
      held++;
    } else {
      dots.push('none');
    }
  }

  return { dots, shownUp, held };
}
