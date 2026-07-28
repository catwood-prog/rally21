// PA4 — the friendship number's display rules, kept pure so the laws
// below are pinned by tests rather than eyeballed on a screen.
//
// Rally21-Personal-Arc-Decision-Memo.md §5.1, Rally21-Glow-Spec.md §3/§5.

import { PairStreak } from './glow';

/**
 * THE FORBIDDEN SHAPE (Glow-Spec §5): "friend streaks are shared pride
 * between two people, not a leaderboard. Nobody sees a ranked list,
 * ever."
 *
 * That is why this returns ONE pair or nothing, and why it is a
 * function rather than a sorted array a caller could map over. Sorting
 * happens here, in a scope where only the winner escapes — a rendered
 * `.sort()` in a screen is one `.slice(0, 3)` away from being a
 * leaderboard, and that edit would not look like a product decision at
 * review time.
 */
export const PAIR_HEADLINE_MIN_DAYS = 3;

/**
 * The single best friendship to show on a circle screen, or null.
 *
 * Scoped to pairs formed through THIS circle (`sharedThisCircle`), which
 * is the display rule Glow-Spec §3 states — "best among the members
 * shown" — while the underlying data stays app-level. A member who has
 * LEFT still qualifies: the server forms pairs from shared history, not
 * current membership, so the friendship survives the circle exactly as
 * §3 requires.
 *
 * Ranked on the CUMULATIVE number, never the run: the run is the
 * fragile one, and letting it choose the winner would put a broken
 * streak in charge of which friendship is worth naming.
 */
export function bestPairForCircle(pairs: PairStreak[]): PairStreak | null {
  const eligible = pairs.filter(
    (p) => p.sharedThisCircle && p.daysTogether >= PAIR_HEADLINE_MIN_DAYS
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, p) => {
    if (p.daysTogether !== best.daysTogether) return p.daysTogether > best.daysTogether ? p : best;
    // Deterministic tiebreak so the headline doesn't flicker between two
    // equal friendships on consecutive loads: live run first, then name.
    if (p.streak !== best.streak) return p.streak > best.streak ? p : best;
    return p.otherName.localeCompare(best.otherName) < 0 ? p : best;
  });
}

/** A run of 1 is not a run — it is just today. The flourish appears only
 * once there is genuinely something consecutive to show, so a friendship
 * whose run has broken shows its cumulative number alone rather than a
 * zero (memo §5.1: "the zeros that do appear attach to the small
 * number", and a zero we simply don't draw is better still). */
export const PAIR_RUN_MIN_DAYS = 2;

export function shouldShowPairRun(pair: PairStreak): boolean {
  return pair.streak >= PAIR_RUN_MIN_DAYS;
}

/**
 * Shared milestones ride the CUMULATIVE number (memo §5.1: the headline
 * "never falls, and it carries the shared milestones at 25/50/100").
 *
 * They deliberately do NOT ride the consecutive run any more. Before
 * PA4 the digest fired pair milestones off the run at 7/21/50/100/200/
 * 365; leaving that in place would have announced the fragile number as
 * an achievement while the memo was busy demoting it, and a pair could
 * be congratulated twice for one friendship. One ladder, on the number
 * that cannot be taken away.
 *
 * THE RUNGS ARE CAT'S, RULED 28 July (CY1), replacing PA4's [25, 50, 100]
 * — which she was shown had a real cost: the cohort's best pair sits at 9
 * cumulative, so a first rung of 25 meant no friendship in the app would
 * be acknowledged for months, where the old run ladder fired at 7.
 *
 * 21 IS THE FIRST RALLY, and that is the whole reason it leads: it is the
 * same meaning the personal ladder's 21 carries, so the 21-rung copy says
 * "your first rally together" rather than reusing the generic line (see
 * pairMilestoneDigestLine in constants/strings.ts). KNOWN AND ACCEPTED by
 * Cat, not a bug: a perfectly daily pair can cross their personal 21 and
 * their pair 21 on the same day.
 *
 * MIRRORED BY HAND in supabase/functions/compose-digest/index.ts — Deno
 * edge functions cannot import the client's module graph, so a change
 * here is only half a change until that constant moves with it.
 */
export const PAIR_MILESTONES = [21, 50, 75, 100] as const;

/** The milestone crossed between two readings of the cumulative number,
 * or null. Only ever ONE — the highest crossed — so a long gap in the
 * digest can never produce a backlog of congratulations. */
export function crossedPairMilestone(before: number, after: number): number | null {
  let crossed: number | null = null;
  for (const m of PAIR_MILESTONES) {
    if (after >= m && before < m) crossed = m;
  }
  return crossed;
}
