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
//
// AR5 (5 Aug) — the whole set becomes state-aware on PM1C's ONE gate.
// Two of the four base chips ("what are you noticing about me?",
// "what's getting in my way lately?") are RETRIEVAL questions: they ask
// Rally to read a file that, below the floors, is honestly empty. The
// shrug that came back was the honesty law working correctly — the
// defect was the chip promising what the file can't pay, and every shrug
// spent one of the day's five messages. So below the floors those two
// hide and the cold-start chips show; AT the floors they return. The
// graduation is the design, not a fallback: the retrieval chips come
// back exactly when Rally can answer them.

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

/** THE FLOOR, one predicate, one place. AR5 extends this gate from the
 * personal chip to the whole starter set rather than inventing a second
 * mechanism, and the two uses answer the same question: a pattern solid
 * enough to build a personal chip on is exactly a pattern Rally can
 * answer "what are you noticing about me?" from. Synthesis rows fail it
 * structurally (B2 inserts them with NULL agreement/total) — deliberate,
 * and the conservative direction: a chip that under-promises costs
 * nothing, a chip that over-promises costs a message. */
function meetsEvidenceFloor(p: BlueprintPattern): boolean {
  return (
    p.agreementCount >= PERSONAL_CHIP_MIN_AGREEMENT &&
    p.evidenceRate >= PERSONAL_CHIP_MIN_EVIDENCE_RATE
  );
}

/** Whether the private map holds enough for the RETRIEVAL chips to be
 * answerable — the same floor derivePersonalChip filters on, which is
 * why `!hasBlueprintEvidence(p)` structurally implies
 * `derivePersonalChip(p, …) === null` and the two can never disagree. */
export function hasBlueprintEvidence(patterns: BlueprintPattern[]): boolean {
  return patterns.some(meetsEvidenceFloor);
}

/** The obstacle chip's text, or null. Fixed table lookup on the stored
 * ON2 key and nothing else: no obstacle, or a key the table doesn't
 * know, renders NO chip rather than a composed one. */
export function obstacleChipFor(obstacle: string | null | undefined): string | null {
  if (!obstacle) return null;
  return STRINGS.askRallyObstacleChips[obstacle] ?? null;
}

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
    .filter(meetsEvidenceFloor)
    .map((p) => ({ key: p.patternKey, question: personalQuestionFor(p) }))
    .filter((q): q is { key: string; question: string } => q.question !== null)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (qualifying.length === 0) return null;
  return qualifying[mixedSeededIndex(`personal-chip-${userId}-${localDate}`, qualifying.length)]
    .question;
}

export type StarterChip = { text: string; personal: boolean };

/** AR5 — the set below the floors. Slot 1 keeps PM1B's own meaning
 * (the in-my-way slot): the recovery chip takes it on a genuinely
 * missed-yesterday day, otherwise the obstacle chip does when one
 * exists, and it is simply absent when neither applies — THREE chips,
 * not four padded with a retrieval question. The two chips that already
 * work cold keep their slots verbatim.
 *
 * The recovery chip is deliberately still reachable here: missedYesterday
 * needs real practice earlier in the visible week, so a lapse below the
 * floors is a genuine lapse, and dropping the chip on evidence grounds
 * would remove the warmest thing on the screen from exactly the person
 * who needs it. It displaces the obstacle chip rather than joining it —
 * same territory, and "never five" holds by construction. */
function buildColdStartChips(opts: {
  hasMissedYesterday: boolean;
  obstacle?: string | null;
}): string[] {
  const inMyWaySlot = opts.hasMissedYesterday
    ? STRINGS.askRallyRecoveryChip
    : obstacleChipFor(opts.obstacle);
  return [
    STRINGS.askRallyTodayChip,
    ...(inMyWaySlot ? [inMyWaySlot] : []),
    STRINGS.blueprintAskChips[2],
    STRINGS.blueprintAskChips[3],
  ];
}

/** The four chips to render, in Cat's ruled order (the approved comp's
 * own ordering). The recovery chip keeps its PM1B rule — it replaces
 * "what's getting in my way lately?" on a missed-yesterday day. The
 * personal chip removes "am I expecting too much of myself?" and takes
 * the FIRST slot, featured. Always four chips, never five.
 *
 * `hasEvidence` is REQUIRED rather than defaulted (AR5): a gate that
 * silently defaults to "yes, the file can pay" is the same promise-
 * without-a-mechanism defect this section exists to remove, so every
 * call site states what it measured. Below it, the cold-start set —
 * and `personalQuestion` cannot contend there, since it is derived
 * through the same floor and is structurally null whenever this is
 * false.
 *
 * The obstacle chip is NOT marked `personal`: that flag prints "from
 * your check-ins", and the obstacle came from the Day-0 intake, not a
 * check-in. Reusing it would make a false provenance claim, and a
 * second label is outside this section's scope — flagged for Cat. */
export function buildStarterChips(opts: {
  hasMissedYesterday: boolean;
  hasEvidence: boolean;
  personalQuestion?: string | null;
  obstacle?: string | null;
}): StarterChip[] {
  if (!opts.hasEvidence) {
    return buildColdStartChips(opts).map((text) => ({ text, personal: false }));
  }
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
