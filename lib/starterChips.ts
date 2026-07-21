import { STRINGS } from '@/constants/strings';

import { BlueprintPattern, formatCutoffHourLabel, WEEKDAY_PLURAL } from './blueprint';
import { WeekDay } from './glow';

// PM1B (21 July) — the starter-chip set, shared by the private map's
// invitation card and the Ask Rally screen's own chip grid. The one rule
// that matters: "how do I get back on track?" may only ever render on a
// genuinely missed-yesterday day — a false "you lapsed" signal is the one
// failure mode this feature cannot have.
//
// PM1C (21 July) — the personal chip: when the blueprint holds strong
// evidence about this user, slot 1 becomes a personal question built from
// a fixed per-type template (constants/strings.ts), displacing "am I
// expecting too much of myself?" — four chips always. Its own forbidden
// failure mode is a false or creepy inference; when in doubt, nothing
// personal renders.

/** Whether the user genuinely missed yesterday, read from the same week
 * row the restart logic uses (get_my_week via getMyWeek — see
 * didRekindleToday in lib/glow.ts: a missed, uncovered day always reads
 * 'none', while a covered day reads 'held' and is NOT a miss). The
 * second condition — some day before yesterday shows practice — is the
 * no-yesterday-to-miss guard: a brand-new or mid-onboarding user (or
 * anyone whose visible week holds no practice at all, whom welcome-back
 * re-entry already greets) gets the standard four chips, never a lapse
 * signal built from an empty history. */
export function missedYesterday(week: WeekDay[]): boolean {
  if (week.length < 2) return false;
  const yesterday = week[week.length - 2];
  if (yesterday.state !== 'none') return false;
  return week.slice(0, week.length - 2).some((day) => day.state !== 'none');
}

/** PM1C's evidence gate, reusing the blueprint's own thresholds:
 * evidenceRate >= 0.6 is describeConfidence's 'fairly sure' floor (and
 * B1's own detection floor for the time-of-day and consistency
 * patterns); agreementCount >= 5 reuses B1's smallest minimum-sample
 * floor (weekday_mood's `v_count >= 5`), applied to the AGREEING
 * check-ins so a chip always stands on at least five real data points —
 * stricter than detection, deliberately. Synthesis rows carry no counts
 * (B2 inserts them with NULL agreement/total), so they fail this gate
 * structurally as well as having no template. */
const PERSONAL_CHIP_MIN_EVIDENCE_RATE = 0.6;
const PERSONAL_CHIP_MIN_AGREEMENT = 5;

/** The fixed template per deterministic pattern type — copy lives in
 * constants/strings.ts; this only routes structured fields into it.
 * Returns null for any row it can't phrase honestly (synthesis types,
 * missing fields): never free-compose from raw data. */
function personalQuestionFor(p: BlueprintPattern): string | null {
  if (p.patternType === 'weekday_mood' && p.weekday !== null) {
    const plural = WEEKDAY_PLURAL[p.weekday]?.toLowerCase();
    if (!plural) return null;
    if (p.direction === 'low') return STRINGS.personalChipWeekdayLow(plural);
    if (p.direction === 'high') return STRINGS.personalChipWeekdayHigh(plural);
    return null;
  }
  if (p.patternType === 'time_of_day_mood') {
    if (p.direction === 'before_noon_higher') return STRINGS.personalChipBeforeNoon;
    if (p.direction === 'after_noon_higher') return STRINGS.personalChipAfterNoon;
    return null;
  }
  if (p.patternType === 'consistency' && p.cutoffHour !== null) {
    return STRINGS.personalChipConsistency(formatCutoffHourLabel(p.cutoffHour));
  }
  return null;
}

/** mixedSeededIndex — a copy of the murmur3-style avalanche finalizer in
 * supabase/functions/compose-nudges/nudge-lines.ts (the NQ2 lesson: a
 * plain 31-multiplier hash whose seeds share a `${userId}-${localDate}`
 * suffix picks with a badly skewed distribution; the finalizer breaks
 * the affine relation). Duplicated because the edge-function module
 * can't be imported into the app bundle. */
function mixedSeededIndex(seedStr: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % mod;
}

/** The personal question for today, or null when nothing qualifies.
 * Deterministic per user per local day: the qualifying set is sorted by
 * patternKey, then one is picked by the avalanche-mixed day seed — same
 * user, same day, same chip. */
export function derivePersonalChip(
  patterns: BlueprintPattern[],
  userId: string,
  localDate: string
): string | null {
  if (!userId) return null;
  const qualifying = patterns
    .filter(
      (p) =>
        p.agreementCount >= PERSONAL_CHIP_MIN_AGREEMENT &&
        p.evidenceRate >= PERSONAL_CHIP_MIN_EVIDENCE_RATE
    )
    .map((p) => ({ key: p.patternKey, question: personalQuestionFor(p) }))
    .filter((q): q is { key: string; question: string } => q.question !== null)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (qualifying.length === 0) return null;
  return qualifying[mixedSeededIndex(`personal-chip-${userId}-${localDate}`, qualifying.length)]
    .question;
}

export type StarterChip = { text: string; personal: boolean };

/** The four chips to render, in Cat's ruled order (the approved comp's
 * own ordering). The recovery chip keeps its PM1B rule — it replaces
 * "what's getting in my way lately?" on a missed-yesterday day. The
 * personal chip removes "am I expecting too much of myself?" and takes
 * the FIRST slot, featured. Always four chips, never five. */
export function buildStarterChips(opts: {
  hasMissedYesterday: boolean;
  personalQuestion?: string | null;
}): StarterChip[] {
  const base: string[] = [...STRINGS.blueprintAskChips];
  if (opts.hasMissedYesterday) base[1] = STRINGS.askRallyRecoveryChip;
  if (opts.personalQuestion) {
    base.splice(2, 1);
    return [
      { text: opts.personalQuestion, personal: true },
      ...base.map((text) => ({ text, personal: false })),
    ];
  }
  return base.map((text) => ({ text, personal: false }));
}
