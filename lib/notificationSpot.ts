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
 * rest fold into one quiet line. Never a scrolling feed. */
export const SPOT_MAX_LINES = 3;

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
}): SpotContent | null {
  const { isReentry, warmth, covers, glowHeld, circleCount } = input;

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
    headline: isReentry ? STRINGS.todaySpotWelcomeHeadline : null,
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
