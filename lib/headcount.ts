// AU1 job 2 (3 Aug) — the "who's in today" line, one decision for all
// three call sites (Today's single-circle card, Today's stacked cards,
// the circle screen's header status).
//
// THE MIS-ASSEMBLY THIS REPLACES. The all-in celebration read
// `that's all ${count} of ${circleName} in today 🔥` — a CIRCLE NAME in
// the slot where a group-of-people noun belongs. It had never been
// grammatical at any N ("all 5 of Read before bed"), but it only became
// visible when N fell to 1: on Cat's own Today, 2 August, her
// circle-mate had been quiet since 23 July, so RS1's resting rule
// dropped the active roster to one, she checked in, and the card
// celebrated a party of one as
//
//   "that's all 1 of Breath of Fire & Fists of Anger - morning boost
//    in today 🔥"
//
// The circle screen's header carried an `activeMemberCount > 1` guard
// from the start; Today's two call sites never did. That divergence is
// the reason this is a shared function rather than three inline
// ternaries — the guard now cannot be present in one place and missing
// in another.
//
// THE COUNTING RULE, and why callers must pass an ACTIVE-ONLY inCount.
// RS1/RS2/PA2 already exclude resting, away and finished members from
// the denominator (they are still real members, just quietly at the edge
// for now — the circle screen owns the visual fade). The numerator was
// never given the same rule: it counted every completion row for today,
// including an away or finished member's. Two consequences, both live:
// the line could read "3 of 2 in today", and the equality that triggers
// the celebration could be reached by a DIFFERENT set of people than the
// active roster. A member who checks in today is never resting by
// construction (isResting measures days since their last completion), so
// this only ever moved away/finished members — see the call sites, which
// intersect the active roster with today's presence rather than passing
// `inTodayUserIds.size`.
import { STRINGS } from '@/constants/strings';

/**
 * The one headcount sentence. `inCount` must already be restricted to
 * members counted in `activeCount` (see above) — this function trusts
 * the pair and only decides which of the four shapes to say.
 */
export function headcountLine(inCount: number, activeCount: number): string {
  // Nobody left on the active roster: there is no "everyone" to have
  // arrived, so the all-in branch must not be reachable here. It used to
  // be — 0 === 0 satisfied the old equality and celebrated an empty room.
  if (activeCount <= 0) return STRINGS.cardLinkNobodyIn;
  // `>=` rather than `===`: with an active-only numerator the two can
  // never cross, and a belt against a caller that skips the intersection
  // is cheaper than the "3 of 2" render it prevents.
  if (inCount >= activeCount) {
    return activeCount > 1
      ? STRINGS.groupAllInCelebration(activeCount)
      : STRINGS.groupAllInCelebrationLone;
  }
  return STRINGS.cardLinkStatus(inCount, activeCount);
}
