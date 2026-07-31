import { STRINGS } from '@/constants/strings';

import { checkinClosingBeat, ClosingBeat, glowBeatClosingBeat } from './closingBeat';

/**
 * SC4 job 2 — the full label matrix, pinned cell by cell, plus the ladder
 * shape job 1 rewired. These are the tests OD1 job 9d never had: its
 * labels were correct but held in place by comment reasoning about which
 * cases were mutually exclusive, and the DEFERRED entry records that the
 * docs session made exactly the misreading those comments were meant to
 * prevent. The matrix is small enough to enumerate, so it is enumerated.
 */

const checkin = (over: Partial<Parameters<typeof checkinClosingBeat>[0]> = {}) =>
  checkinClosingBeat({
    isDayComplete: true,
    awaitingCount: 0,
    showsGlowBeat: false,
    cardResolved: false,
    ...over,
  });

describe('checkin-complete: destination and label always agree', () => {
  it('never guesses at a farewell before the day-close read lands', () => {
    expect(checkin({ isDayComplete: null }).cta).toBe(STRINGS.checkinSuccessCta);
    // ...and that stays true even with a card already resolved: an
    // unresolved day must not let one through the day-done gate.
    const withCard = checkin({ isDayComplete: null, cardResolved: true });
    expect(withCard.cardFollows).toBe(false);
    expect(withCard.cta).toBe(STRINGS.checkinSuccessCta);
  });

  it('leads forward with a count while practices are still open', () => {
    expect(checkin({ isDayComplete: false, awaitingCount: 1 }).cta).toBe(STRINGS.checkinMoreTodayCta(1));
    expect(checkin({ isDayComplete: false, awaitingCount: 3 }).cta).toBe(STRINGS.checkinMoreTodayCta(3));
  });

  it('OD1 job 9b — a mid-day check-in never gets a card, however eligible', () => {
    const beat = checkin({ isDayComplete: false, awaitingCount: 2, cardResolved: true });
    expect(beat.cardFollows).toBe(false);
    expect(beat.next).toBe('today');
  });

  it('owns the goodbye when nothing follows it', () => {
    const beat = checkin({ isDayComplete: true });
    expect(beat.next).toBe('today');
    expect(beat.cta).toBe(STRINGS.dayDoneCta);
  });

  it('leads into the card when the card is the next screen', () => {
    const beat = checkin({ isDayComplete: true, cardResolved: true });
    expect(beat.next).toBe('share-card');
    expect(beat.cardFollows).toBe(true);
    expect(beat.cta).toBe(STRINGS.checkinCardComingCta);
    expect(beat.cta).not.toBe(STRINGS.dayDoneCta);
  });

  it('leads into the glow beat when the glow beat is the next screen', () => {
    const beat = checkin({ isDayComplete: true, showsGlowBeat: true });
    expect(beat.next).toBe('glow-beat');
    expect(beat.cta).toBe(STRINGS.glowBeatContinueCta);
  });

  // SC4's new cell: glow beat AND card on the same day. checkin-complete's
  // own label is unchanged (what comes next is still the glow beat) but
  // the card must now travel with the navigation instead of being dropped.
  it('SC4 — hands the card forward THROUGH the glow beat', () => {
    const beat = checkin({ isDayComplete: true, showsGlowBeat: true, cardResolved: true });
    expect(beat.next).toBe('glow-beat');
    expect(beat.cardFollows).toBe(true);
    expect(beat.cta).toBe(STRINGS.glowBeatContinueCta);
  });

  it('a destination is only ever promised a card when one is really coming', () => {
    const cases: ClosingBeat[] = [
      checkin({ isDayComplete: null, cardResolved: true }),
      checkin({ isDayComplete: false, cardResolved: true }),
      checkin({ isDayComplete: true, cardResolved: false }),
      checkin({ isDayComplete: true, showsGlowBeat: true, cardResolved: false }),
    ];
    for (const beat of cases) expect(beat.cardFollows).toBe(false);
  });
});

describe('glow-beat: last only when nothing follows', () => {
  it('closes the day when it IS last and the day is done', () => {
    const beat = glowBeatClosingBeat({ isDayComplete: true, cardFollows: false });
    expect(beat.next).toBe('today');
    expect(beat.cta).toBe(STRINGS.dayDoneCta);
  });

  it('leads forward when practices are still open', () => {
    expect(glowBeatClosingBeat({ isDayComplete: false, cardFollows: false }).cta).toBe(
      STRINGS.glowBeatContinueCta
    );
  });

  it('never risks a false goodbye on an unresolved read', () => {
    expect(glowBeatClosingBeat({ isDayComplete: null, cardFollows: false }).cta).not.toBe(
      STRINGS.dayDoneCta
    );
  });

  // The cell SC4 creates. This is the label most likely to be got wrong:
  // the glow beat used to be last on every day it fired.
  it('SC4 — hands the gift forward instead of saying goodbye when a card follows', () => {
    const beat = glowBeatClosingBeat({ isDayComplete: true, cardFollows: true });
    expect(beat.next).toBe('share-card');
    expect(beat.cta).toBe(STRINGS.checkinCardComingCta);
    expect(beat.cta).not.toBe(STRINGS.dayDoneCta);
  });
});

/**
 * The invariant OD1 job 9d's comments were arguing for, now checked
 * directly across the whole three-screen sequence rather than reasoned
 * about: exactly one goodbye per day, and no line said twice in a row.
 * The card screen's own closer is a constant (shareCardCloseCta), so it
 * is spliced in as the terminator wherever a card follows.
 */
function fullSequence(input: {
  isDayComplete: boolean | null;
  awaitingCount: number;
  showsGlowBeat: boolean;
  cardResolved: boolean;
}): string[] {
  const labels: string[] = [];
  const first = checkinClosingBeat(input);
  labels.push(first.cta);
  if (first.next === 'glow-beat') {
    const second = glowBeatClosingBeat({
      isDayComplete: input.isDayComplete,
      cardFollows: first.cardFollows,
    });
    labels.push(second.cta);
    if (second.next === 'share-card') labels.push(STRINGS.shareCardCloseCta);
  } else if (first.next === 'share-card') {
    labels.push(STRINGS.shareCardCloseCta);
  }
  return labels;
}

describe('the whole sequence, every state', () => {
  const states = [true, false, null] as const;

  it('says goodbye at most once, and only ever on the last screen', () => {
    for (const isDayComplete of states) {
      for (const showsGlowBeat of [true, false]) {
        for (const cardResolved of [true, false]) {
          const labels = fullSequence({ isDayComplete, awaitingCount: 2, showsGlowBeat, cardResolved });
          const farewells = labels.filter(
            (l) => l === STRINGS.dayDoneCta || l === STRINGS.shareCardCloseCta
          );
          expect(farewells.length).toBeLessThanOrEqual(1);
          if (farewells.length === 1) {
            expect(labels[labels.length - 1]).toBe(farewells[0]);
          }
        }
      }
    }
  });

  it('never repeats a label within one sequence', () => {
    for (const isDayComplete of states) {
      for (const showsGlowBeat of [true, false]) {
        for (const cardResolved of [true, false]) {
          const labels = fullSequence({ isDayComplete, awaitingCount: 2, showsGlowBeat, cardResolved });
          expect(new Set(labels).size).toBe(labels.length);
        }
      }
    }
  });

  it('the card day with a glow beat is three screens and closes on the card', () => {
    expect(
      fullSequence({ isDayComplete: true, awaitingCount: 0, showsGlowBeat: true, cardResolved: true })
    ).toEqual([STRINGS.glowBeatContinueCta, STRINGS.checkinCardComingCta, STRINGS.shareCardCloseCta]);
  });

  it('a completed day with no card is still one screen', () => {
    expect(
      fullSequence({ isDayComplete: true, awaitingCount: 0, showsGlowBeat: false, cardResolved: false })
    ).toEqual([STRINGS.dayDoneCta]);
  });
});
