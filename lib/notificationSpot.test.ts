import { STRINGS } from '@/constants/strings';

import {
  buildNotificationSpot,
  CoverMoment,
  joinGifts,
  PebbleGiftMoment,
  shouldMoveSpotBelowCta,
  SPOT_MAX_LINES,
  welcomeLineForObstacle,
} from './notificationSpot';
import { KeepGoingObstacle, OBSTACLE_KEYS } from './onboardingIntake';
import { FreshWarmth } from './warmth';

// AU1 job 3b/3c — every moment now carries WHO sent it. The helpers
// derive a stable id from the name so ordinary tests read as before,
// while the same-name and missing-id cases can be written explicitly.
function wave(senderName: string, createdAt: string, senderId = `u-${senderName}`): FreshWarmth {
  return { kind: 'wave', senderId, senderName, senderAvatarUrl: null, createdAt };
}
function heart(senderName: string, createdAt: string, senderId = `u-${senderName}`): FreshWarmth {
  return { kind: 'heart', senderId, senderName, senderAvatarUrl: null, createdAt };
}
function cover(covererName: string, at: string, covererId = `u-${covererName}`): CoverMoment {
  return { covererId, covererName, covererAvatarUrl: null, at };
}
function pebble(senderName: string, at: string, senderId = `u-${senderName}`): PebbleGiftMoment {
  return { senderId, senderName, senderAvatarUrl: null, at };
}

const QUIET = {
  isReentry: false,
  warmth: [],
  covers: [],
  pebbleGifts: [],
  pebbleHeldPlace: false,
  glowHeld: true,
  circleCount: 1,
  obstacle: null,
};

// The spot inherits WL2's whisper laws (empty in = absent surface, a cap
// with a quiet overflow line, newest first) plus TN1's own: welcome-back
// is a MODE of the same card, the glow sentence must be true or absent,
// and one marker value consumes warmth and covers together.
describe('the spot is warmth or it is absent (mockup frame B)', () => {
  it('nothing to say and no re-entry → null, Today is exactly its live layout', () => {
    expect(buildNotificationSpot(QUIET)).toBeNull();
  });

  it('a re-entry with a totally quiet circle still renders — the moment IS the message', () => {
    const spot = buildNotificationSpot({ ...QUIET, isReentry: true });
    expect(spot).not.toBeNull();
    expect(spot?.kicker).toBe(STRINGS.todaySpotKickerWelcomeBack);
    expect(spot?.headline).toBe(STRINGS.todaySpotWelcomeHeadline);
    expect(spot?.cards).toEqual([]);
    // Nothing to consume, so the seen-marker must not move.
    expect(spot?.newestAt).toBeNull();
  });
});

describe('everyday moments (mockup frame C)', () => {
  it('a heart and a cover read as their own cards under the everyday kicker', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [heart('Russ', '2026-07-24T09:00:00.222222+00:00')],
      covers: [cover('Catherine', '2026-07-24T08:00:00.111111+00:00')],
    });
    expect(spot?.kicker).toBe(STRINGS.todaySpotKickerEveryday);
    expect(spot?.headline).toBeNull();
    expect(spot?.footnote).toBeNull();
    expect(spot?.cards.map((c) => c.text)).toEqual([
      STRINGS.todaySpotHeartLine('Russ'),
      STRINGS.todaySpotCoverLine('Catherine'),
    ]);
  });

  it('newest first, across event types', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [heart('Russ', '2026-07-24T08:00:00Z')],
      covers: [cover('Catherine', '2026-07-24T09:00:00Z')],
    });
    expect(spot?.cards.map((c) => c.text)).toEqual([
      STRINGS.todaySpotCoverLine('Catherine'),
      STRINGS.todaySpotHeartLine('Russ'),
    ]);
  });

  it('the same friend covering you in two circles is ONE moment, not two identical cards', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      covers: [cover('Catherine', '2026-07-24T08:00:00Z'), cover('Catherine', '2026-07-24T09:00:00Z')],
    });
    expect(spot?.cards).toHaveLength(1);
    // The marker still clears the newer of the two rows.
    expect(spot?.newestAt).toBe('2026-07-24T09:00:00Z');
  });

  it('keys are stable and unique so React never collapses two people', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [heart('Russ', '2026-07-24T09:00:00Z'), heart('Bo', '2026-07-24T08:00:00Z')],
    });
    const keys = spot!.cards.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('each card carries the identity its avatar needs — never initials (AV1)', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [
        {
          kind: 'heart',
          senderId: 'u-russ',
          senderName: 'Russ',
          senderAvatarUrl: 'https://example.test/russ.jpg',
          createdAt: '2026-07-24T09:00:00Z',
        },
      ],
    });
    expect(spot?.cards[0].person).toEqual({
      id: 'u-russ',
      name: 'Russ',
      avatarUrl: 'https://example.test/russ.jpg',
    });
  });
});

// AU1 job 3c (Cat's ruling, 3 Aug) — ONE CARD PER PERSON.
describe('per-sender merging — a person can never appear twice', () => {
  it('the reported bug: the same friend waving in two circles is ONE card, named once', () => {
    // Waves were the one moment list never deduped by sender, so this
    // rendered "Cathy S and Cathy S sent you a wave 👋".
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [
        wave('Cathy S', '2026-07-24T09:00:00Z'),
        wave('Cathy S', '2026-07-24T08:00:00Z'),
      ],
    });
    expect(spot?.cards).toHaveLength(1);
    expect(spot?.cards[0].text).toBe(STRINGS.todaySpotWaveLine('Cathy S'));
    expect(spot?.cards[0].text).not.toMatch(/Cathy S.*Cathy S/);
  });

  it("the live cohort case: Catherine S's five unseen moments are all one person", () => {
    // Queried from production on 3 Aug, not invented: Catherine S has
    // five rows waiting and every one is from Cathy S — two waves and
    // three hearts across two circles. Before AU1 this rendered as
    // "Cathy S and Cathy S sent you a wave 👋" plus three separate
    // "Cathy S sent you a heart 🧡" lines, filling the whole card with
    // one person named five times.
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [
        heart('Cathy S', '2026-08-02T14:53:21.882065Z', 'u-cathy'),
        wave('Cathy S', '2026-07-29T13:54:26.726009Z', 'u-cathy'),
        heart('Cathy S', '2026-07-29T13:54:25.274429Z', 'u-cathy'),
        wave('Cathy S', '2026-07-28T01:34:19.046507Z', 'u-cathy'),
        heart('Cathy S', '2026-07-28T01:34:18.247138Z', 'u-cathy'),
      ],
    });
    expect(spot?.cards).toHaveLength(1);
    expect(spot?.cards[0].text).toBe('Cathy S sent you a wave 👋 and a heart 🧡');
    expect(spot?.overflowCount).toBe(0);
    // The marker still clears the newest of all five.
    expect(spot?.newestAt).toBe('2026-08-02T14:53:21.882065Z');
  });

  it('everything one person sent merges into their one sentence', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [
        wave('Russ', '2026-07-24T09:00:00Z'),
        heart('Russ', '2026-07-24T10:00:00Z'),
      ],
      pebbleGifts: [pebble('Russ', '2026-07-24T11:00:00Z')],
    });
    expect(spot?.cards).toHaveLength(1);
    expect(spot?.cards[0].text).toBe('Russ sent you a wave 👋, a heart 🧡 and a pebble 🪨');
    // The card is ordered by their NEWEST moment.
    expect(spot?.cards[0].at).toBe('2026-07-24T11:00:00Z');
  });

  it('a cover keeps its own clause rather than being flattened into the gift list', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [heart('Alex', '2026-07-24T09:00:00Z')],
      covers: [cover('Alex', '2026-07-24T08:00:00Z')],
    });
    expect(spot?.cards).toHaveLength(1);
    expect(spot?.cards[0].text).toBe('Alex covered you yesterday and sent you a heart 🧡');
  });

  it('a single gesture reads EXACTLY as it shipped — merging only changes busier cards', () => {
    const one = (input: Partial<Parameters<typeof buildNotificationSpot>[0]>) =>
      buildNotificationSpot({ ...QUIET, ...input })!.cards[0].text;
    expect(one({ warmth: [wave('Russ', '2026-07-24T09:00:00Z')] })).toBe(
      STRINGS.todaySpotWaveLine('Russ')
    );
    expect(one({ warmth: [heart('Russ', '2026-07-24T09:00:00Z')] })).toBe(
      STRINGS.todaySpotHeartLine('Russ')
    );
    expect(one({ pebbleGifts: [pebble('Russ', '2026-07-24T09:00:00Z')] })).toBe(
      STRINGS.todaySpotPebbleGiftLine('Russ')
    );
    expect(one({ covers: [cover('Russ', '2026-07-24T09:00:00Z')] })).toBe(
      STRINGS.todaySpotCoverLine('Russ')
    );
  });

  it('repeats of the SAME gesture never become a count', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [
        heart('Russ', '2026-07-24T09:00:00Z'),
        heart('Russ', '2026-07-24T10:00:00Z'),
        heart('Russ', '2026-07-24T11:00:00Z'),
      ],
    });
    expect(spot?.cards[0].text).toBe(STRINGS.todaySpotHeartLine('Russ'));
    expect(spot?.cards[0].text).not.toMatch(/\d/);
  });

  it('two circle-mates who share a display name stay two people', () => {
    // The whole reason merging keys on the user id: a name-keyed merge
    // would attribute one person's wave to the other.
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [
        wave('Catherine', '2026-07-24T09:00:00Z', 'u-1'),
        heart('Catherine', '2026-07-24T08:00:00Z', 'u-2'),
      ],
    });
    expect(spot?.cards).toHaveLength(2);
    expect(spot?.cards.map((c) => c.text)).toEqual([
      STRINGS.todaySpotWaveLine('Catherine'),
      STRINGS.todaySpotHeartLine('Catherine'),
    ]);
  });

  it('an unresolved sender still merges, falling back to the name (WL2 keeps their warmth readable)', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [
        wave('a circle-mate', '2026-07-24T09:00:00Z', null as unknown as string),
        heart('a circle-mate', '2026-07-24T08:00:00Z', null as unknown as string),
      ],
    });
    expect(spot?.cards).toHaveLength(1);
    expect(spot?.cards[0].person.id).toBeNull();
  });
});

describe('the cap and its quiet overflow line (WL2 whisper law, retargeted)', () => {
  it(`renders ${SPOT_MAX_LINES} people individually, no overflow marker below the cap`, () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: Array.from({ length: SPOT_MAX_LINES }, (_, i) =>
        heart(`friend-${i}`, `2026-07-2${i + 1}T10:00:00Z`)
      ),
    });
    expect(spot?.cards).toHaveLength(SPOT_MAX_LINES);
    expect(spot?.overflowCount).toBe(0);
  });

  it('beyond the cap folds into one count — never a scrolling feed', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: Array.from({ length: SPOT_MAX_LINES + 3 }, (_, i) =>
        heart(`friend-${i}`, `2026-07-1${i}T10:00:00Z`)
      ),
    });
    expect(spot?.cards).toHaveLength(SPOT_MAX_LINES);
    expect(spot?.overflowCount).toBe(3);
  });

  it('the marker clears the folded moments too — the overflow line IS the acknowledgement', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: Array.from({ length: SPOT_MAX_LINES + 2 }, (_, i) =>
        heart(`friend-${i}`, `2026-07-1${9 - i}T10:00:00Z`)
      ),
    });
    // Rows arrive newest-first, so the newest of ALL of them is row 0.
    expect(spot?.newestAt).toBe('2026-07-19T10:00:00Z');
  });

  it('the overflow counts PEOPLE, and a busy sender costs one slot, not four', () => {
    // Pre-AU1 this person would have occupied every slot on the card by
    // themselves and pushed three other friends into the count.
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [
        wave('Busy', '2026-07-24T12:00:00Z'),
        heart('Busy', '2026-07-24T11:30:00Z'),
        heart('b', '2026-07-24T11:00:00Z'),
        heart('c', '2026-07-24T10:00:00Z'),
        heart('d', '2026-07-24T09:00:00Z'),
      ],
      pebbleGifts: [pebble('Busy', '2026-07-24T11:45:00Z')],
    });
    expect(spot?.cards).toHaveLength(SPOT_MAX_LINES);
    expect(spot?.cards[0].text).toBe('Busy sent you a wave 👋, a heart 🧡 and a pebble 🪨');
    // Four people, three shown: exactly one folded.
    expect(spot?.overflowCount).toBe(1);
  });
});

describe('the welcome-back mode (mockup frame A)', () => {
  it('two friends waving are two cards, each with their own face', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      isReentry: true,
      warmth: [wave('Russ', '2026-07-24T09:00:00Z'), wave('Catherine', '2026-07-24T08:00:00Z')],
    });
    expect(spot?.cards.map((c) => c.text)).toEqual([
      STRINGS.todaySpotWaveLine('Russ'),
      STRINGS.todaySpotWaveLine('Catherine'),
    ]);
  });

  it('a waver is PINNED on re-entry — a flurry of newer hearts can never bury them', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      isReentry: true,
      warmth: [
        heart('a', '2026-07-24T12:00:00Z'),
        heart('b', '2026-07-24T11:00:00Z'),
        heart('c', '2026-07-24T10:00:00Z'),
        wave('Russ', '2026-07-24T09:00:00Z'),
        wave('Catherine', '2026-07-24T08:00:00Z'),
      ],
    });
    // "Your people missed you" is part of the welcome-back message, so
    // both wavers outrank every newer heart.
    expect(spot?.cards.map((c) => c.text)).toEqual([
      STRINGS.todaySpotWaveLine('Russ'),
      STRINGS.todaySpotWaveLine('Catherine'),
      STRINGS.todaySpotHeartLine('a'),
    ]);
    expect(spot?.overflowCount).toBe(2);
    // …and the marker still clears the genuinely newest moment.
    expect(spot?.newestAt).toBe('2026-07-24T12:00:00Z');
  });

  it('on an ORDINARY day a waver is just another person, newest-first', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [heart('a', '2026-07-24T12:00:00Z'), wave('Russ', '2026-07-24T09:00:00Z')],
    });
    expect(spot?.cards[0].text).toBe(STRINGS.todaySpotHeartLine('a'));
  });

  it('a glowing person is told the truth: no streak lost', () => {
    const spot = buildNotificationSpot({ ...QUIET, isReentry: true, glowHeld: true, circleCount: 2 });
    expect(spot?.footnote).toBe(STRINGS.welcomeBackSubtitleHeld(2));
  });

  it('a run that ENDED is told the pebble-era truth, guilt-free (OD1 job 14, AU1 job 3d)', () => {
    const spot = buildNotificationSpot({ ...QUIET, isReentry: true, glowHeld: false });
    expect(spot?.footnote).toBe(STRINGS.welcomeBackSubtitleReset);
    expect(spot?.footnote).not.toMatch(/missed nothing/i);
    // The pre-PA3 word: a run ends and the longest rally is KEPT, so
    // nothing here may describe a counter going back to zero.
    expect(spot?.footnote).not.toMatch(/reset/i);
    expect(spot?.footnote).toMatch(/longest rally is kept/);
  });

  it('no footnote on this card carries an em dash any more (AU1 job 3d)', () => {
    const held = buildNotificationSpot({ ...QUIET, isReentry: true, glowHeld: true })!;
    const ended = buildNotificationSpot({ ...QUIET, isReentry: true, glowHeld: false })!;
    const pebbleHeld = buildNotificationSpot({
      ...QUIET,
      isReentry: true,
      glowHeld: true,
      pebbleHeldPlace: true,
    })!;
    for (const spot of [held, ended, pebbleHeld]) {
      expect(spot.footnote).not.toContain('—');
    }
  });

  it('an UNKNOWN glow says nothing rather than guessing — both branches are factual claims', () => {
    const spot = buildNotificationSpot({ ...QUIET, isReentry: true, glowHeld: null });
    expect(spot?.footnote).toBeNull();
    expect(spot?.headline).toBe(STRINGS.todaySpotWelcomeHeadline);
  });

  it('nothing anywhere is a badge, a count or an alarm — warmth only', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      isReentry: true,
      warmth: [wave('Russ', '2026-07-24T09:00:00Z')],
      covers: [cover('Catherine', '2026-07-24T08:00:00Z')],
    });
    const all = [spot?.kicker, spot?.headline, spot?.footnote, ...spot!.cards.map((c) => c.text)].join(' ');
    expect(all).not.toMatch(/\d+ (new|unread)|\bunread\b|\(\d+\)/i);
  });
});

// AR3 — TN1's fold gap, Cat's ruling: the spot must never push Today's
// check-in CTA below the fold, and it REORDERS to obey rather than
// shedding warmth. These pin the rule so it stays "pinned by tests, not
// eyeballed on a device" — the same standard the shed version was held
// to, applied to what replaced it.
//
// RE-AFFIRMED by Cat, 3 Aug (AU1 job 3a): the spot's home is the top of
// Today and it only ever steps below the button on the specific screens
// where staying there would hide the button. Nothing in this section
// changes the rule.
//
// The measurements behind the numbers, taken at 390x844 with a MAXIMAL
// seven-row spot: Today alone never crosses (625 at 1.5x, 731 at 1.64x),
// the spot pushes it to 903 and 1054, and a moment line is worth only
// 22-34px. That is why the lever is the whole card, not a line of it.
describe('the fold rule — the spot never pushes check-in off the screen', () => {
  const FOLD = 844;

  it('leaves the spot alone when the CTA already fits', () => {
    expect(
      shouldMoveSpotBelowCta({
        viewportHeight: FOLD,
        ctaBottomWithSpotAbove: 660, // measured, 1x
        spotBlockHeight: 210,
      })
    ).toBe(false);
  });

  it('moves the spot below when the CTA would cross the fold (1.5x, measured)', () => {
    expect(
      shouldMoveSpotBelowCta({
        viewportHeight: FOLD,
        ctaBottomWithSpotAbove: 903,
        spotBlockHeight: 253,
      })
    ).toBe(true);
  });

  it('moves it at 1.64x too, where shedding a line never could', () => {
    // 1054 - 34 (one moment line) = 1020, still 176px under water; the
    // whole card is 281, which clears it. This is the case that killed
    // the shed.
    expect(
      shouldMoveSpotBelowCta({
        viewportHeight: FOLD,
        ctaBottomWithSpotAbove: 1054,
        spotBlockHeight: 281,
      })
    ).toBe(true);
  });

  it('does NOT fire at 1.23 or 1.35, where nothing was ever broken', () => {
    // The old threshold shed a line at both of these. Measurement does
    // not, because the CTA was above the fold the whole time.
    expect(
      shouldMoveSpotBelowCta({ viewportHeight: FOLD, ctaBottomWithSpotAbove: 756, spotBlockHeight: 228 })
    ).toBe(false);
    expect(
      shouldMoveSpotBelowCta({ viewportHeight: FOLD, ctaBottomWithSpotAbove: 810, spotBlockHeight: 239 })
    ).toBe(false);
  });

  it('declines when moving would not rescue the CTA — the spot is not the cause', () => {
    // Several stacked circles: the CTA is far below the fold and losing
    // the spot from above it changes nothing worth churning the layout
    // for.
    expect(
      shouldMoveSpotBelowCta({ viewportHeight: FOLD, ctaBottomWithSpotAbove: 1600, spotBlockHeight: 240 })
    ).toBe(false);
  });

  it('never reorders on an unmeasured screen', () => {
    expect(
      shouldMoveSpotBelowCta({ viewportHeight: 0, ctaBottomWithSpotAbove: 900, spotBlockHeight: 240 })
    ).toBe(false);
    expect(
      shouldMoveSpotBelowCta({ viewportHeight: FOLD, ctaBottomWithSpotAbove: 0, spotBlockHeight: 240 })
    ).toBe(false);
  });

  it('is a pure function of the content, so the two layouts cannot oscillate', () => {
    // today.tsx normalises its measurement to the "spot above" frame
    // before asking, so the answer never depends on where the spot
    // currently is. Same content in, same verdict out, both ways round.
    const content = { viewportHeight: FOLD, ctaBottomWithSpotAbove: 903, spotBlockHeight: 253 };
    const verdictWhenAbove = shouldMoveSpotBelowCta(content);
    // What today.tsx computes once the spot has already moved: the CTA
    // measures 253px higher, and it adds that back before asking.
    const measuredWhenBelow = 903 - 253;
    const verdictWhenBelow = shouldMoveSpotBelowCta({
      ...content,
      ctaBottomWithSpotAbove: measuredWhenBelow + 253,
    });
    expect(verdictWhenBelow).toBe(verdictWhenAbove);
    expect(verdictWhenAbove).toBe(true);
  });

  it('the spot itself is NEVER shortened — no moment and no footnote is traded for space', () => {
    // Job 14's glow sentence is truth-telling copy, not padding, and
    // the cap is Cat's one default. Reordering is what yields.
    const fourPeople = {
      ...QUIET,
      isReentry: true,
      glowHeld: false,
      warmth: [
        heart('Russ', '2026-07-24T12:00:00Z'),
        heart('Catherine', '2026-07-24T11:00:00Z'),
        heart('Bo', '2026-07-24T10:00:00Z'),
        heart('Ada', '2026-07-24T09:00:00Z'),
      ],
    };
    const spot = buildNotificationSpot(fourPeople)!;
    expect(spot.cards).toHaveLength(SPOT_MAX_LINES);
    expect(spot.overflowCount).toBe(1);
    expect(spot.footnote).toBe(STRINGS.welcomeBackSubtitleReset);
    // There is exactly one cap, and no large-text variant of it exists
    // to be reinstated.
    expect(SPOT_MAX_LINES).toBe(3);
  });
});

// ON2 job C — the lean. The Day-0 obstacle biases WHICH EXISTING
// welcome-back line surfaces after a miss, and touches nothing else on
// the card: not the kicker, not the sender cards, not job 14's glow
// footnote, and not NS1's timing (which this module cannot reach at all).
describe('ON2 the obstacle leans the welcome line', () => {
  it('each obstacle surfaces its own line, and only the headline changes', () => {
    const neutral = buildNotificationSpot({ ...QUIET, isReentry: true })!;
    for (const key of OBSTACLE_KEYS) {
      const spot = buildNotificationSpot({ ...QUIET, isReentry: true, obstacle: key })!;
      expect(spot.headline).toBe(STRINGS.todaySpotWelcomeLineByObstacle[key]);
      expect(spot.headline).not.toBe(STRINGS.todaySpotWelcomeHeadline);
      // Everything else on the card is byte-identical to the neutral one.
      expect(spot.kicker).toBe(neutral.kicker);
      expect(spot.cards).toEqual(neutral.cards);
      expect(spot.footnote).toBe(neutral.footnote);
      expect(spot.overflowCount).toBe(neutral.overflowCount);
      expect(spot.newestAt).toBe(neutral.newestAt);
    }
  });

  it("'forget' leans on the reminders/NS1 flavour, 'miss once' on beginning again", () => {
    expect(welcomeLineForObstacle('forget')).toBe(STRINGS.todaySpotWelcomeLineByObstacle.forget);
    expect(welcomeLineForObstacle('miss_once')).toMatch(/starting again/);
  });

  it('an unanswered obstacle falls back to the neutral line — every pre-ON2 account, unchanged', () => {
    expect(welcomeLineForObstacle(null)).toBe(STRINGS.todaySpotWelcomeHeadline);
    const spot = buildNotificationSpot({ ...QUIET, isReentry: true, obstacle: null })!;
    expect(spot.headline).toBe(STRINGS.todaySpotWelcomeHeadline);
  });

  it('an unrecognised stored value falls back to neutral rather than a blank headline', () => {
    expect(welcomeLineForObstacle('bogus' as KeepGoingObstacle)).toBe(STRINGS.todaySpotWelcomeHeadline);
  });

  it('the lean never puts a welcome line on an ordinary day — only re-entry has a headline', () => {
    for (const key of OBSTACLE_KEYS) {
      const spot = buildNotificationSpot({
        ...QUIET,
        obstacle: key,
        warmth: [heart('Russ', '2026-07-24T09:00:00Z')],
      })!;
      expect(spot.headline).toBeNull();
    }
  });

  it('the lean chooses copy and nothing else — it cannot change what a moment says', () => {
    const moments = {
      warmth: [wave('Russ', '2026-07-24T10:00:00Z')],
      covers: [cover('Catherine', '2026-07-24T09:00:00Z')],
    };
    const neutral = buildNotificationSpot({ ...QUIET, isReentry: true, ...moments })!;
    const leaned = buildNotificationSpot({ ...QUIET, isReentry: true, obstacle: 'alone', ...moments })!;
    expect(leaned.cards.map((c) => c.text)).toEqual(neutral.cards.map((c) => c.text));
    expect(leaned.newestAt).toBe(neutral.newestAt);
  });
});

describe('joinGifts', () => {
  it('reads as a sentence at one, two and three gifts — and never as a count', () => {
    expect(joinGifts([])).toBe('');
    expect(joinGifts(['a wave 👋'])).toBe('a wave 👋');
    expect(joinGifts(['a wave 👋', 'a heart 🧡'])).toBe('a wave 👋 and a heart 🧡');
    expect(joinGifts(['a wave 👋', 'a heart 🧡', 'a pebble 🪨'])).toBe(
      'a wave 👋, a heart 🧡 and a pebble 🪨'
    );
  });
});
