// TN1 (24 July, Cat's ruling — mockup APPROVED, frames A/B/C) — Today's
// ONE notification surface.
//
// A returning person lands on TODAY, one tap from checking in, never on
// an interstitial: welcome-back's content compresses into a warm spot at
// the top of Today, and the same spot carries every other warm moment
// (waves, hearts, covers). When there is nothing to say it does not
// render at all and Today is exactly today's live layout — the surface
// is warmth or it is absent. NO badges, NO unread counts, NO red, ever.
//
// This module is the spot's whole render decision, kept pure so the laws
// above are pinned by tests rather than eyeballed on a screen. WL2's
// buildWhisperLines/WHISPER_MAX_LINES are RETIRED into it (their cases
// live on in notificationSpot.test.ts) — two surfaces for the same
// recipient-private warmth would be two doors to one room.
//
// EVENT SOURCES (traced in the real code before any of this was built —
// nothing here renders from reasoning):
// - waves + hearts: public.wall_messages rows with recipient_id =
//   auth.uid() and kind in ('wave','heart'), served newest-first by the
//   get_my_fresh_warmth() RPC (lib/warmth.ts), whose seen-gate is
//   SERVER-side against users.warmth_seen_at.
// - covers: public.completions rows with kind='covered' for the caller,
//   local_date = their local yesterday (CV1's next-day rescue), read via
//   getCirclePresence's existing per-circle query. Its created_at is
//   gated client-side against the SAME users.warmth_seen_at marker, so
//   the spot has one freshness rule rather than one per event type.
// No new tables, and no event is rendered from a source that was not
// read.
import { STRINGS } from '@/constants/strings';

import type { KeepGoingObstacle } from './onboardingIntake';
import { FreshWarmth } from './warmth';

/** A cover of the caller's own missed day, ready for the spot. `at` is
 * the completions row's raw server created_at, passed through verbatim
 * so the seen-marker never loses microseconds (WL2's rule). */
export type CoverMoment = {
  covererId: string | null;
  covererName: string;
  covererAvatarUrl: string | null;
  at: string;
};

/** PA3 job 3 — a pebble a friend put in your nest. Same shape and same
 * freshness rule as a cover: the server gates it against
 * users.warmth_seen_at, so the spot keeps ONE freshness rule rather than
 * one per event type. */
export type PebbleGiftMoment = {
  senderId: string | null;
  senderName: string;
  senderAvatarUrl: string | null;
  at: string;
};

/** AU1 job 3b — the person a card belongs to. Carries what
 * components/Avatar.tsx needs (AV1: the penguin variant is deterministic
 * on the user id, and a photo replaces it everywhere at once), never
 * initials. */
export type SpotPerson = {
  /** Null only when the sender row could not be resolved — WL2's left
   * join deliberately keeps a departed member's warmth readable. */
  id: string | null;
  name: string;
  avatarUrl: string | null;
};

/** AU1 job 3c — ONE CARD PER PERSON. `text` is everything that person
 * sent, merged into a single sentence. */
export type SpotCard = {
  key: string;
  person: SpotPerson;
  text: string;
  /** That person's NEWEST moment, which is what orders the cards. */
  at: string;
};

export type SpotContent = {
  kicker: string;
  /** Only the re-entry moment has a headline; everyday moments don't. */
  headline: string | null;
  cards: SpotCard[];
  /** PEOPLE folded into the quiet overflow line (a card is a person now),
   * never a badge count. */
  overflowCount: number;
  /** The re-entry moment's ONE guilt-free glow sentence (OD1 job 14's
   * truth-telling copy family); null on an ordinary day. */
  footnote: string | null;
  /** Newest moment timestamp across everything FETCHED — the value the
   * seen-marker advances to once this spot has rendered. Null when the
   * spot carries no moments at all (a re-entry with a quiet circle), in
   * which case there is nothing to consume. */
  newestAt: string | null;
};

/** Cat's default (overrulable): three PEOPLE render individually, the
 * rest fold into one quiet line. Never a scrolling feed. This is the ONE
 * cap; there is deliberately no large-text variant — see below.
 *
 * AU1 job 3c — the unit changed from moments to people (one card per
 * sender), so three is now a harder cap than it was: a person who sent
 * four things costs one slot, not four. Cat, 3 Aug: "if someday ten
 * senders overflow the box, compression is a future design
 * conversation, not this section's." */
export const SPOT_MAX_LINES = 3;

/**
 * TN1's fold gap, and why NOTHING here shortens the card (AR3, Cat's
 * ruling, 26 July).
 *
 * THE RULE: the spot must never push Today's check-in CTA below the fold.
 * A maximal spot — kicker, headline, three moment lines, the overflow
 * line and the footnote, seven rows — does exactly that at accessibility
 * text sizes, which Today on its own never does.
 *
 * WHAT WAS TRIED AND IS NOW SUPERSEDED (c04700d, reverted here): shedding
 * a moment line above a fixed font-scale threshold. It was the wrong size
 * of remedy, and measurement is what showed it: a moment line is worth
 * 22–34px, and at 1.5x the CTA overshoots the fold by 59px (903 against
 * 844); at 1.64x by 210px. It also failed on TN1's own reported number —
 * 877 − 28 = 849, still under.
 *
 * That version carried an asymmetry argument for firing a step EARLY:
 * firing early costs one moment its own line, firing late costs the
 * person the button, so err early. That argument is SUPERSEDED, not
 * wrong. It was only ever needed because the trigger was a GUESS at which
 * text scale the fold would be crossed — and a guess has to be wrong in
 * some direction, so it should be wrong in the cheap one. Once the
 * trigger is a MEASUREMENT of whether this screen's CTA actually crosses
 * the fold, there is no direction to err in and nothing to trade: the
 * threshold fired at 1.23 and 1.35 where nothing was broken, and still
 * did not save the sizes that were. Do not reinstate it.
 *
 * WHAT REPLACED IT: Today REORDERS rather than sheds — the spot moves
 * below the CTA when (and only when) it would otherwise push it off the
 * screen. Nothing is deleted, so the rule holds at ANY spot height rather
 * than up to a guess, and job 14's glow footnote — the truth-telling
 * sentence that replaced "you missed nothing" — is never available as
 * space. The decision itself is shouldMoveSpotBelowCta below, kept here
 * and kept pure so the rule stays pinned by tests rather than eyeballed
 * on a device; today.tsx only feeds it measurements.
 */
export function shouldMoveSpotBelowCta(input: {
  /** The scroll viewport's own height — the fold. */
  viewportHeight: number;
  /** The CTA's bottom edge in CONTENT coordinates, as it would be with
   * the spot ABOVE it. Normalising to that one frame is what makes this
   * a pure function of the content instead of a function of where the
   * spot currently is, so it cannot oscillate between the two layouts. */
  ctaBottomWithSpotAbove: number;
  /** How much vertical space the spot occupies above the CTA, margin
   * included — i.e. exactly what moving it below gives back. */
  spotBlockHeight: number;
}): boolean {
  const { viewportHeight, ctaBottomWithSpotAbove, spotBlockHeight } = input;
  // Nothing measured yet: never reorder on a guess.
  if (viewportHeight <= 0 || ctaBottomWithSpotAbove <= 0) return false;
  const fits = ctaBottomWithSpotAbove <= viewportHeight;
  if (fits) return false;
  // It does not fit — but only move the spot if moving it actually
  // rescues the CTA. When Today is long enough that the CTA is below the
  // fold anyway (several stacked circles), the spot is not the cause and
  // reordering would be churn that fixes nothing.
  return ctaBottomWithSpotAbove - spotBlockHeight <= viewportHeight;
}

/**
 * ON2 job C (28 July) — THE LEAN, and the whole of it.
 *
 * ON1 asked the person at Day 0 what usually makes it hard to keep going.
 * The half of job 2 never built was the payoff: that answer should bias
 * which existing welcome-back line they meet when they come back from a
 * miss. Since TN1 the welcome-back interstitial is gone, so the line it
 * biases is THIS spot's welcome line — the one the mockup calls "your
 * place is still here" — and nothing else on the card.
 *
 * WHAT IT DOES NOT DO, deliberately: it writes no new copy (every
 * candidate is an existing NQ1 line, pinned to its pool by test), it
 * recomputes nothing, and it does not go near NS1's timing algorithm —
 * the lean only ever CHOOSES copy. It is also strictly additive for
 * everyone who has not answered Q2, which today is every existing
 * account: a null obstacle returns the neutral line byte-for-byte.
 *
 * An unrecognised value falls back to neutral rather than throwing — the
 * column is CHECK-constrained, but a stale client reading a value a newer
 * migration added should show the shipped line, not a blank headline.
 */
export function welcomeLineForObstacle(obstacle: KeepGoingObstacle | null): string {
  const leaned = obstacle ? STRINGS.todaySpotWelcomeLineByObstacle[obstacle] : undefined;
  return leaned ?? STRINGS.todaySpotWelcomeHeadline;
}

/** "a wave 👋" / "a wave 👋 and a heart 🧡" / "a wave 👋, a heart 🧡 and
 * a pebble 🪨" — the gift half of one person's merged sentence. Never a
 * count ("2 hearts"): the spot says who and what, never how many. */
export function joinGifts(gifts: string[]): string {
  if (gifts.length <= 1) return gifts[0] ?? '';
  if (gifts.length === 2) return `${gifts[0]} and ${gifts[1]}`;
  return `${gifts.slice(0, -1).join(', ')} and ${gifts[gifts.length - 1]}`;
}

/** AU1 job 3c — the identity a person's moments merge on.
 *
 * The user id when the server resolved one, which is every ordinary
 * case; the NAME only as a fallback, for WL2's deliberately-preserved
 * warmth from a member who has since left (its left join can yield a
 * row the users table no longer resolves). Falling back to the name is
 * the same merge the whole spot used to do, so the fallback path is no
 * worse than what shipped — and the id path is what makes two
 * circle-mates who share a display name two cards instead of one. */
function personKey(id: string | null, name: string): string {
  return id ? `id:${id}` : `name:${name}`;
}

/** Ordering only — the marker itself always carries the raw server
 * string through verbatim (WL2's microsecond rule), never a Date. */
function ms(at: string): number {
  return new Date(at).getTime();
}

/** One person's moments, accumulating as the four sources are walked. */
type PersonBucket = {
  person: SpotPerson;
  /** Insertion-ordered and deduped: a friend who sent two hearts sent a
   * heart, and the same friend covering you in two circles covered you.
   * This is where dedupeCovers's job went — it is now the general rule
   * rather than the one type that happened to have it. */
  gifts: string[];
  covered: boolean;
  /** Their newest moment, which orders the cards. */
  at: string;
  /** On re-entry a wave is not one moment among many, it is PART of the
   * welcome-back message ("your people missed you"), so a person who
   * waved is never pushed into the overflow by newer hearts. */
  waved: boolean;
};

/**
 * AU1 job 3c — one person's merged sentence.
 *
 * THE PROPERTY THAT MATTERS: for a person who sent exactly one thing,
 * every sentence here is byte-identical to the shipped, Cat-approved
 * wording ("Russ sent you a wave 👋", "Russ sent you a heart 🧡", "Russ
 * sent you a pebble 🪨", "Russ covered you yesterday"). Merging only
 * ever changes what a BUSIER card says — the ordinary one-gesture card,
 * which is almost every card, reads exactly as it did before.
 *
 * A cover keeps its own clause rather than joining the gift list,
 * because covering someone is not sending them a thing.
 */
function sentenceFor(bucket: PersonBucket): string {
  const { person, gifts, covered } = bucket;
  const joined = joinGifts(gifts);
  if (covered && gifts.length > 0) {
    return STRINGS.todaySpotCoverAndSentLine(person.name, joined);
  }
  if (covered) return STRINGS.todaySpotCoverLine(person.name);
  return STRINGS.todaySpotSentLine(person.name, joined);
}

export function buildNotificationSpot(input: {
  /** True when Today's own re-entry detection fired for this visit (a
   * gap of 2+ missed days, not yet acknowledged). */
  isReentry: boolean;
  /** Fresh warmth as served by get_my_fresh_warmth (newest first). */
  warmth: FreshWarmth[];
  covers: CoverMoment[];
  /** PA3 — pebbles friends have put in this person's nest, not yet told. */
  pebbleGifts: PebbleGiftMoment[];
  /** PA3 job 2 — TRUE when a pebble from the person's OWN nest is what is
   * holding their place right now (getMyGlow().heldByToday === 'pebble').
   *
   * This is the whole of "applied automatically, and the person is told
   * warmly AFTERWARDS rather than asked in advance" (memo §5.2). The
   * users most needing protection are exactly the ones not opening the
   * app, so an offer requiring acceptance would protect the wrong people
   * — which is why nothing here asks, and why the telling rides the
   * re-entry moment TN1 already detects and already acknowledges
   * durably (users.last_reentry_ack_date), rather than inventing a
   * second marker that could nag. */
  pebbleHeldPlace: boolean;
  /** getMyGlow().state === 'glowing' — the ONE source of truth for
   * whether "no streak lost" is honest right now (OD1 job 14). Never
   * assumed from the re-entry trigger alone. NULL when the glow read
   * failed: the sentence is then omitted entirely rather than guessed,
   * because both branches make a factual claim about this person's own
   * streak and a wrong one is exactly what job 14 corrected. */
  glowHeld: boolean | null;
  circleCount: number;
  /** ON2 — the person's Day-0 obstacle (users.keep_going_obstacle), one
   * answer per person since the column moved off the membership. Null
   * when skipped or never asked, which is every pre-ON1 account. */
  obstacle: KeepGoingObstacle | null;
}): SpotContent | null {
  const { isReentry, warmth, covers, pebbleGifts, pebbleHeldPlace, glowHeld, circleCount, obstacle } =
    input;

  // AU1 job 3c — every moment from every source lands in its SENDER's
  // bucket. This is the whole of "Cathy S and Cathy S can never render":
  // a name cannot appear twice in one sentence because a person cannot
  // appear twice in one bucket, and cannot appear on two cards because a
  // bucket is a card.
  const byPerson = new Map<string, PersonBucket>();

  function bucketFor(person: SpotPerson, at: string): PersonBucket {
    const key = personKey(person.id, person.name);
    const existing = byPerson.get(key);
    if (existing) {
      // Keep the newest moment as the card's timestamp, and prefer a
      // resolved avatar if any one of their moments carried one.
      if (ms(at) > ms(existing.at)) existing.at = at;
      if (!existing.person.avatarUrl && person.avatarUrl) {
        existing.person.avatarUrl = person.avatarUrl;
      }
      return existing;
    }
    const fresh: PersonBucket = {
      person: { ...person },
      gifts: [],
      covered: false,
      at,
      waved: false,
    };
    byPerson.set(key, fresh);
    return fresh;
  }

  function addGift(bucket: PersonBucket, gift: string) {
    if (!bucket.gifts.includes(gift)) bucket.gifts.push(gift);
  }

  // Order of the walks decides the order gifts read inside one sentence
  // (wave, then heart, then pebble) — a stable reading order rather than
  // a timestamp shuffle inside a single person's line.
  for (const w of warmth) {
    if (w.kind !== 'wave') continue;
    const bucket = bucketFor(
      { id: w.senderId, name: w.senderName, avatarUrl: w.senderAvatarUrl },
      w.createdAt
    );
    addGift(bucket, STRINGS.todaySpotGiftWave);
    bucket.waved = true;
  }
  for (const h of warmth) {
    if (h.kind !== 'heart') continue;
    const bucket = bucketFor(
      { id: h.senderId, name: h.senderName, avatarUrl: h.senderAvatarUrl },
      h.createdAt
    );
    addGift(bucket, STRINGS.todaySpotGiftHeart);
  }
  for (const p of pebbleGifts) {
    const bucket = bucketFor(
      { id: p.senderId, name: p.senderName, avatarUrl: p.senderAvatarUrl },
      p.at
    );
    addGift(bucket, STRINGS.todaySpotGiftPebble);
  }
  for (const c of covers) {
    // Covers can arrive from more than one circle on the same day; the
    // same friend covering you twice is ONE moment. `covered` being a
    // boolean is what makes that true now.
    const bucket = bucketFor(
      { id: c.covererId, name: c.covererName, avatarUrl: c.covererAvatarUrl },
      c.at
    );
    bucket.covered = true;
  }

  const buckets = [...byPerson.values()];

  // Nothing to say and no re-entry to mark → the spot is absent
  // entirely, never an empty frame (mockup frame B).
  if (buckets.length === 0 && !isReentry) return null;

  // The marker advances past everything FETCHED, including the people
  // folded into the overflow line — the quiet "and N more" is the
  // acknowledgement, exactly as WL2's whisper overflow behaved. Taken
  // BEFORE the pin reorders anything, so it stays a pure "newest of all".
  const newestAt = buckets.reduce<string | null>(
    (newest, b) => (newest === null || ms(b.at) > ms(newest) ? b.at : newest),
    null
  );

  buckets.sort((a, b) => {
    const aPinned = isReentry && a.waved;
    const bPinned = isReentry && b.waved;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return ms(b.at) - ms(a.at);
  });
  const shown = buckets.slice(0, SPOT_MAX_LINES);
  // People, not moments — a card is a person, so "and 2 more from your
  // circle" means two more people.
  const overflowCount = buckets.length - shown.length;

  return {
    kicker: isReentry ? STRINGS.todaySpotKickerWelcomeBack : STRINGS.todaySpotKickerEveryday,
    headline: isReentry ? welcomeLineForObstacle(obstacle) : null,
    cards: shown.map((b) => ({
      key: personKey(b.person.id, b.person.name),
      person: b.person,
      text: sentenceFor(b),
      at: b.at,
    })),
    overflowCount,
    // PA3 job 2 — the telling-afterwards. When a pebble from their own
    // nest is what held the place, SAY SO: "no streak lost" is true but
    // silent about the mechanic, and a mechanic nobody is told about is
    // not "visible and self-serve". The pebble line replaces the generic
    // held line rather than joining it — two sentences making the same
    // claim would be the nag this surface exists to avoid.
    //
    // Still gated on glowHeld !== null: a failed glow read means the
    // truth is unknown, and both branches state a fact about this
    // person's own streak (OD1 job 14). pebbleHeldPlace comes from the
    // SAME read, so it is never trusted when that read failed.
    footnote:
      isReentry && glowHeld !== null
        ? glowHeld
          ? pebbleHeldPlace
            ? STRINGS.todaySpotPebbleHeldLine
            : STRINGS.welcomeBackSubtitleHeld(circleCount)
          : STRINGS.welcomeBackSubtitleReset
        : null,
    newestAt,
  };
}
