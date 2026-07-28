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
export type CoverMoment = { covererName: string; at: string };

export type SpotLine = { key: string; text: string; at: string };

export type SpotContent = {
  kicker: string;
  /** Only the re-entry moment has a headline; everyday moments don't. */
  headline: string | null;
  lines: SpotLine[];
  /** Moments folded into the quiet overflow line, never a badge count. */
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

/** Cat's default (overrulable): three moments render individually, the
 * rest fold into one quiet line. Never a scrolling feed. This is the ONE
 * cap; there is deliberately no large-text variant — see below. */
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

/** "Russ" / "Russ and Catherine" / "Russ, Catherine and Bo" / "Russ,
 * Catherine and 2 others" — warm, never a headcount. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/** Covers can arrive from more than one circle on the same day; the same
 * friend covering you in two circles is ONE moment, not two identical
 * lines. Keeps the newest timestamp so the seen-marker still advances
 * past every row. */
function dedupeCovers(covers: CoverMoment[]): CoverMoment[] {
  const byName = new Map<string, CoverMoment>();
  for (const c of covers) {
    const seen = byName.get(c.covererName);
    if (!seen || ms(c.at) > ms(seen.at)) byName.set(c.covererName, c);
  }
  return [...byName.values()];
}

/** Ordering only — the marker itself always carries the raw server
 * string through verbatim (WL2's microsecond rule), never a Date. */
function ms(at: string): number {
  return new Date(at).getTime();
}

export function buildNotificationSpot(input: {
  /** True when Today's own re-entry detection fired for this visit (a
   * gap of 2+ missed days, not yet acknowledged). */
  isReentry: boolean;
  /** Fresh warmth as served by get_my_fresh_warmth (newest first). */
  warmth: FreshWarmth[];
  covers: CoverMoment[];
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
  const { isReentry, warmth, covers, glowHeld, circleCount, obstacle } = input;

  const waves = warmth.filter((w) => w.kind === 'wave');
  const hearts = warmth.filter((w) => w.kind === 'heart');
  const uniqueCovers = dedupeCovers(covers);

  // Every line carries how many MOMENTS it stands for, so a dropped
  // grouped line contributes its whole group to the overflow count.
  // `pinned` outranks the newest-first ordering: on re-entry the wave
  // line is not one moment among many, it is PART of the welcome-back
  // message ("your people missed you"), so a flurry of newer hearts must
  // never push it into the overflow.
  const grouped: { line: SpotLine; moments: number; pinned: boolean }[] = [];

  if (waves.length > 0) {
    grouped.push({
      line: {
        key: `wave-${waves[0].createdAt}`,
        text: STRINGS.todaySpotWaveLine(joinNames(waves.map((w) => w.senderName))),
        at: waves[0].createdAt,
      },
      moments: waves.length,
      pinned: isReentry,
    });
  }
  for (const h of hearts) {
    grouped.push({
      line: {
        key: `heart-${h.createdAt}-${h.senderName}`,
        text: STRINGS.todaySpotHeartLine(h.senderName),
        at: h.createdAt,
      },
      moments: 1,
      pinned: false,
    });
  }
  for (const c of uniqueCovers) {
    grouped.push({
      line: {
        key: `cover-${c.at}-${c.covererName}`,
        text: STRINGS.todaySpotCoverLine(c.covererName),
        at: c.at,
      },
      moments: 1,
      pinned: false,
    });
  }

  // Nothing to say and no re-entry to mark → the spot is absent
  // entirely, never an empty frame (mockup frame B).
  if (grouped.length === 0 && !isReentry) return null;

  // The marker advances past everything FETCHED, including the moments
  // folded into the overflow line — the quiet "and N more" is the
  // acknowledgement, exactly as WL2's whisper overflow behaved. Taken
  // BEFORE the pin reorders anything, so it stays a pure "newest of all".
  const newestAt = grouped.reduce<string | null>(
    (newest, g) => (newest === null || ms(g.line.at) > ms(newest) ? g.line.at : newest),
    null
  );

  grouped.sort((a, b) =>
    a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : ms(b.line.at) - ms(a.line.at)
  );
  const shown = grouped.slice(0, SPOT_MAX_LINES);
  const overflowCount = grouped
    .slice(SPOT_MAX_LINES)
    .reduce((sum, g) => sum + g.moments, 0);

  return {
    kicker: isReentry ? STRINGS.todaySpotKickerWelcomeBack : STRINGS.todaySpotKickerEveryday,
    headline: isReentry ? welcomeLineForObstacle(obstacle) : null,
    lines: shown.map((g) => g.line),
    overflowCount,
    footnote:
      isReentry && glowHeld !== null
        ? glowHeld
          ? STRINGS.welcomeBackSubtitleHeld(circleCount)
          : STRINGS.welcomeBackSubtitleReset
        : null,
    newestAt,
  };
}
