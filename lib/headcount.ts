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
// THE COUNTING RULE. RS1/RS2/PA2 exclude resting, away and finished
// members from the denominator (they are still real members, just
// quietly at the edge for now). The numerator was never given the same
// rule: it counted every completion row for today, including an away or
// finished member's. Two consequences, both live: the line could read
// "3 of 2 in today", and the equality that triggers the celebration
// could be reached by a DIFFERENT set of people than the active roster.
// A member who checks in today is never resting by construction
// (isResting measures days since their last completion), so this only
// ever moved away/finished members.
//
// THE HALF-SENTENCE HC1 CORRECTED RATHER THAN DROPPED. This paragraph
// used to head itself "why callers must pass an ACTIVE-ONLY inCount",
// and it ended by pointing at the call sites, "which intersect the
// active roster with today's presence rather than passing
// `inTodayUserIds.size`". That contract is gone: the intersection is
// done HERE now, from the roster, because HC1 needed a THIRD fact of the
// same rows and three call sites deriving three facts each is the
// divergence AU1 existed to end, not a smaller version of it. The
// counting RULE is untouched — only the place it is computed moved.
// HC1 (16 Aug, Cat's ruling) — THE CELEBRATION MAY NOT FIRE OVER AN
// UNTICKED AVATAR, and the counting rule above is untouched to achieve
// it.
//
// WHAT CAT SAW. Two cards on one phone at 17:12 on 16 Aug. "Read before
// bed" read "that's everyone in today 🔥" with Alex Stewart shown and
// UNTICKED; "Stretching/Yoga moves" read "2 of 3 in today" over FOUR
// avatars. Both numbers were correct against the roster rule above —
// Alex's last completion was 11 Aug, exactly RESTING_QUIET_DAYS_THRESHOLD
// days back, so he left the active roster on the very morning she
// looked, dropping it to one and taking the lone-celebration branch. The
// arithmetic was right and the sentence was false.
//
// THE MISMATCH IS STRUCTURAL, NOT ARITHMETIC. The denominator has
// excluded resting/away/finished members since RS1/RS2/PA2 and the
// numerator joined it at AU1; the AVATAR STRIPS beneath never took
// either filter and render every member. So the sentence has always been
// entitled to say "everyone" about a roster smaller than the row of
// faces under it. Cat ruled the denominator KEPT (it is honest about who
// is being asked to show up today) and the celebration GUARDED.
//
// WHY THE ROSTER COMES IN WHOLE RATHER THAN AS A COUNT. This function
// used to take two numbers and trust its caller to have intersected them
// — the shape that let the numerator drift out of step with the
// denominator until AU1 pulled three inline ternaries into one place.
// The guard has exactly that failure mode available to it, in three call
// sites, so it is derived HERE from the same rows the strip renders,
// once. The active roster is now also derived here rather than passed,
// so the pair cannot disagree either.
import { STRINGS } from '@/constants/strings';

/** The fields the headcount reads off a circle member: `isResting` as
 * attachRestingStatus derives it, plus the two stored states. Structural
 * rather than `CircleMember` so the tests can state a roster in the
 * terms the rule actually uses. */
export type HeadcountMember = {
  userId: string;
  isResting: boolean;
  awaySince: string | null;
  finishedAt: string | null;
};

/**
 * The one headcount sentence.
 *
 * `roster` is the strip's FULL source roster — every member the card
 * represents, BEFORE any overflow cap. Deliberately stricter than
 * "visibly rendered": a member sitting inside the circle screen's "+N"
 * chip is still someone the reader would call part of the circle, and a
 * 🔥 line over a hidden absentee is the same false claim as one over a
 * visible absentee, only harder to catch.
 *
 * `inTodayUserIds` is today's completion rows for this circle, any kind
 * — a covered day is presence, it is a gift.
 */
export function headcountLine(
  roster: HeadcountMember[],
  inTodayUserIds: ReadonlySet<string>
): string {
  // RS1/RS2/PA2 — resting, away and finished members are real members
  // held softly at the edge, and they are not who today is being asked
  // of. AU1 gave the numerator the same rule so the pair can never cross.
  const active = roster.filter((m) => !m.isResting && !m.awaySince && !m.finishedAt);
  const activeCount = active.length;
  const inCount = active.filter((m) => inTodayUserIds.has(m.userId)).length;

  // Nobody left on the active roster: there is no "everyone" to have
  // arrived, so the all-in branch must not be reachable here. It used to
  // be — 0 === 0 satisfied the old equality and celebrated an empty room.
  if (activeCount <= 0) return STRINGS.cardLinkNobodyIn;

  // HC1 — the guard. Not "is the active roster all in" (it is, by the
  // line below) but "is EVERY member this card shows in". An away or
  // finished member who checked in today still satisfies it: they are
  // off the active roster but they are ticked, and the reader can see
  // that. Only an unticked face blocks the 🔥.
  const everyoneShownIsIn = roster.every((m) => inTodayUserIds.has(m.userId));

  // `>=` rather than `===`: with an active-only numerator the two can
  // never cross, and a belt against a caller that skips the intersection
  // is cheaper than the "3 of 2" render it prevents.
  if (inCount >= activeCount && everyoneShownIsIn) {
    return activeCount > 1
      ? STRINGS.groupAllInCelebration(activeCount)
      : STRINGS.groupAllInCelebrationLone;
  }
  // A blocked celebration falls here, which makes "1 of 1 in today"
  // reachable on a circle reduced to one active member — Cat ruled that
  // ACCEPTED on 16 Aug. It is odd-looking and it is true, where the
  // sentence it replaces was neither.
  return STRINGS.cardLinkStatus(inCount, activeCount);
}
