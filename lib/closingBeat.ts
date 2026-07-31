import { STRINGS } from '@/constants/strings';

/**
 * SC4 (31 July) — the closing sequence of a check-in, and the label each
 * of its screens wears.
 *
 * WHY THIS IS ONE FILE AND NOT TWO BRANCHES IN TWO SCREENS. Until SC4 the
 * sequence was at most two screens long and each screen hand-wrote its own
 * label, kept honest by a paragraph of comment reasoning about which cases
 * were mutually exclusive. SC4 makes it three screens on a card day, so
 * `checkin-complete` and `glow-beat` now both have to agree about the same
 * question — which is exactly the codebase's own trigger for moving logic
 * here ("shared logic in lib/ gets a test when it gains a second caller").
 *
 * The destination and the label are returned TOGETHER, deliberately. The
 * old shape was two separate ordered branch-lists in one file, and the
 * only thing stopping them drifting was a comment asking the next reader
 * to keep them in the same order. Returning one value makes "the label can
 * never promise a destination the dismissal does not take" structural.
 *
 * OD1 job 9d's principle is the whole specification and is unchanged:
 *
 *   THE LAST SCREEN OWNS THE GOODBYE. Every label answers whether the day
 *   is done; non-last screens lead forward, the last one closes.
 *
 * What SC4 changes is only which screen is last. The sequences are:
 *
 *   milestone / ceremony day   checkin-complete
 *   ordinary, day still open   checkin-complete [-> glow beat]
 *   ordinary, day done         checkin-complete [-> glow beat]
 *   card day, no glow beat     checkin-complete -> card
 *   card day, glow beat        checkin-complete -> glow beat -> card
 *
 * so the glow beat is no longer always last, and on the last line it must
 * lead forward rather than say goodbye.
 */

/** Where a closing screen's one button goes. `'today'` is the plain
 * dismissal — checkin-complete prefers `router.back()` where it can, which
 * lands in the same place; this type names the destination, not the call. */
export type ClosingStop = 'glow-beat' | 'share-card' | 'today';

export type ClosingBeat = {
  next: ClosingStop;
  /** Whether the resolved share card travels with this navigation —
   * either as the glow beat's hand-off payload or as the card screen's own
   * route params. False whenever no card is due today. */
  cardFollows: boolean;
  cta: string;
};

/**
 * checkin-complete's button. Fires on EVERY check-in, so it cannot simply
 * say goodbye: someone with another practice open today must not be told
 * to come back tomorrow.
 *
 * `cardResolved` means a card came back from the cadence call and its
 * params are built — NOT that it will be shown. The day-done gate (OD1 job
 * 9a/9b: a card is an end-of-day beat) is applied here, in one place, so a
 * mid-day multi-circle check-in still gets no card.
 */
export function checkinClosingBeat(input: {
  isDayComplete: boolean | null;
  awaitingCount: number;
  showsGlowBeat: boolean;
  cardResolved: boolean;
}): ClosingBeat {
  const cardFollows = input.cardResolved && input.isDayComplete === true;

  // Not known yet — never guess at a farewell. The glow beat still fires
  // (that decision doesn't depend on the day-close read at all); it is the
  // LABEL that stays neutral until the read lands.
  if (input.isDayComplete === null) {
    return { next: input.showsGlowBeat ? 'glow-beat' : 'today', cardFollows: false, cta: STRINGS.checkinSuccessCta };
  }

  // (a) work remaining, counted: "one more today" is only TRUE when
  // exactly one practice is left, and with a default cap of 3 two or three
  // open is ordinary. No card here — the day isn't done.
  if (!input.isDayComplete) {
    return {
      next: input.showsGlowBeat ? 'glow-beat' : 'today',
      cardFollows: false,
      cta: STRINGS.checkinMoreTodayCta(input.awaitingCount),
    };
  }

  // The glow beat comes next, so this screen is not last and must lead
  // forward. Cat's ruling, 26 July: "keep it glowing" lives HERE, in the
  // day-done case, where being imperative fits — there is nothing left to
  // do today, so it reads as carrying the glow onward rather than asking
  // for more work.
  //
  // SC4 — this branch stays AHEAD of the card branch and its copy is
  // unchanged, because the label answers "what comes next" and on a card
  // day what comes next is still the glow beat. The card simply sits one
  // screen further along now, which is glow-beat's label problem, not
  // this one's.
  if (input.showsGlowBeat) {
    return { next: 'glow-beat', cardFollows, cta: STRINGS.glowBeatContinueCta };
  }

  // (c) no glow beat, but a card follows and closes the day itself (job
  // 8's "see you tomorrow"), so this leads INTO it rather than closing.
  if (cardFollows) {
    return { next: 'share-card', cardFollows: true, cta: STRINGS.checkinCardComingCta };
  }

  // (b) nothing follows — this screen owns the goodbye.
  return { next: 'today', cardFollows: false, cta: STRINGS.dayDoneCta };
}

/**
 * glow-beat's button. Before SC4 this screen was always last and its only
 * question was whether the day was done. Now, twice a week, a card follows
 * it and it has to lead forward instead.
 *
 * `cardFollows` is decided upstream by checkinClosingBeat and travels here
 * as route params — this screen never re-decides whether a card is due, so
 * the cadence call and the day-done gate each still happen exactly once.
 */
export function glowBeatClosingBeat(input: {
  isDayComplete: boolean | null;
  cardFollows: boolean;
}): ClosingBeat {
  // Not last: hand the gift forward with the same line checkin-complete
  // uses when IT is the screen before a card. The farewell stays with the
  // card, which still closes on its own "see you tomorrow".
  if (input.cardFollows) {
    return { next: 'share-card', cardFollows: true, cta: STRINGS.checkinCardComingCta };
  }
  // Last. Day done -> this screen closes it. Still open, or not yet known
  // -> the imperative is a true prompt, which is the state it fits, and an
  // unresolved read never risks a false goodbye.
  return {
    next: 'today',
    cardFollows: false,
    cta: input.isDayComplete ? STRINGS.dayDoneCta : STRINGS.glowBeatContinueCta,
  };
}
