// Q1's deterministic lane (Rally21-Question-Engine-Spec.md §4) — chip
// answers become trait candidates through pure repeat-detection, zero
// LLM cost.
//
// "FAMILY" IS THE QUESTION, NOT THE DIMENSION (RA1 job 3, 31 July;
// MN3's second finding). The original grouping (checkpoint b, 7 July)
// was dimension + recurring chip VALUE, and its stated reason was a
// real constraint: exact-question repeats were 30+ days apart and
// essentially random, so no single question could realistically
// accumulate "3 of last 4" and dimension + value was the only unit
// that could. The cost of that choice was that two questions in one
// dimension sharing a chip value strengthened ONE trait even when the
// value meant opposite things. Enumerated from the live bank, the
// collisions are:
//
//   ENR · "people"   ENR-04 "what DRAINED the most energy from you
//                    today" vs ENR-09 "what RESTORES your energy
//                    fastest" — MN3's example, and exactly backwards
//   ENR · "evening"  ENR-02 "when did you feel MOST ALERT" vs ENR-11
//                    "when do you usually RUN OUT OF STEAM"
//   MOT · "mood"     MOT-05 "what BROUGHT YOU to today's practice" vs
//                    MOT-03 "when you SKIP a day, what's behind it"
//   ENR · "screens"  ENR-04 (what drained you) vs ENR-15 (what you
//                    trade sleep for)
//   ENR · "work"     ENR-04 vs ENR-15, same shape
//   VAL · "people"   VAL-05 (what mattered most today) vs VAL-11
//                    (what a well-spent weekend looks like)
//
// The first three are sign-flipping: they would have built a trait
// that says the opposite of what the person answered. The last three
// merely blur two different claims into one. All six are gone now,
// because the family is (question code, chip value) and two different
// questions can no longer contribute to the same trait at all.
//
// WHAT MAKES THAT AFFORDABLE IS RA1's RE-ASK CYCLE, shipped in the
// same section: the tracked declaration questions come round about
// every 30 days per person, so a single question CAN now reach three
// asks (around day 62-72 for a perfect tester). "3 of the last 4 asks
// of this question" is a far stronger claim than "3 of the last 4
// chip answers anywhere in this dimension" ever was — it is the same
// question, answered the same way, three times running.
//
// The bar is deliberately not lowered to compensate for the narrower
// family. A chip trait that no longer clears it simply does not
// surface, which is the honest outcome.
//
// Writes into the SAME blueprint_versions.content.traits array the LLM
// synthesis (synthesis.ts) writes to — "your deterministic lane writes
// THERE, one blueprint, not a parallel store" (spec §4). Chip-derived
// trait keys are namespaced `chip_<code-slug>_<value-slug>` so they can
// never collide with an LLM-proposed trait key, and this module never
// touches non-chip trait entries.

import { BlueprintTrait } from "./synthesis.ts";

export const CHIP_TRAIT_BASE_CONFIDENCE = 0.4;
export const CHIP_TRAIT_REPEAT_STEP = 0.1;
export const CHIP_TRAIT_CONTRADICTION_STEP = 0.2;
export const CHIP_TRAIT_MIN_EVIDENCE = 3;
export const CHIP_TRAIT_WINDOW = 4;

export interface ChipAnswer {
  local_date: string;
  question_code: string;
  dimension: string;
  chip_value: string;
}

export interface ChipTraitCandidate {
  key: string;
  label: string;
  questionCode: string;
  dimension: string;
  chipValue: string;
  evidence_refs: string[];
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function chipTraitKey(questionCode: string, chipValue: string): string {
  return `chip_${slug(questionCode)}_${slug(chipValue)}`;
}

function isChipTraitKey(key: string): boolean {
  return key.startsWith("chip_");
}

/** The question family a chip-trait key belongs to — the key is the only
 * place this module stores it. Every question code in the bank is
 * `<DIM>-<NN>` (all 130 checked, 31 July), so a question-aware key always
 * reads `chip_<dim>_<nn>_<value…>` and the family is its first three
 * segments.
 *
 * A key whose third segment is not a number is a PRE-RA1 key
 * (`chip_<dim>_<value…>`, grouped by dimension). Those return null: they
 * are dropped rather than migrated, and re-derived from raw answers on the
 * next run, because a dimension-grouped trait may be one of the six
 * collisions above and there is no way to tell which question it came
 * from. Nothing carries a claim about a person forward on a guess. */
function familyOfChipTraitKey(key: string): string | null {
  const parts = key.split("_");
  if (parts.length < 4) return null;
  if (!/^[0-9]+$/.test(parts[2])) return null;
  return parts.slice(0, 3).join("_");
}

/** Per QUESTION, the last CHIP_TRAIT_WINDOW asks of that question — if one
 * chip value holds >=CHIP_TRAIT_MIN_EVIDENCE of that window, it's a
 * candidate. Rows for questions that have never come round again simply
 * never reach the minimum, which is correct. */
export function findDominantChipCandidates(answers: ChipAnswer[]): ChipTraitCandidate[] {
  const byQuestion = new Map<string, ChipAnswer[]>();
  for (const a of answers) {
    if (!a.question_code) continue;
    const list = byQuestion.get(a.question_code) ?? [];
    list.push(a);
    byQuestion.set(a.question_code, list);
  }

  const candidates: ChipTraitCandidate[] = [];
  for (const [questionCode, rows] of byQuestion) {
    const sorted = [...rows].sort((a, b) => a.local_date.localeCompare(b.local_date));
    const window = sorted.slice(-CHIP_TRAIT_WINDOW);
    if (window.length < CHIP_TRAIT_MIN_EVIDENCE) continue;

    const datesByValue = new Map<string, string[]>();
    for (const row of window) {
      const list = datesByValue.get(row.chip_value) ?? [];
      list.push(row.local_date);
      datesByValue.set(row.chip_value, list);
    }

    let bestValue: string | null = null;
    let bestDates: string[] = [];
    for (const [value, dates] of datesByValue) {
      if (dates.length > bestDates.length) {
        bestValue = value;
        bestDates = dates;
      }
    }

    if (bestValue && bestDates.length >= CHIP_TRAIT_MIN_EVIDENCE) {
      candidates.push({
        key: chipTraitKey(questionCode, bestValue),
        label: bestValue,
        questionCode,
        dimension: window[window.length - 1].dimension,
        chipValue: bestValue,
        evidence_refs: bestDates,
      });
    }
  }
  return candidates;
}

export interface ChipTraitMergeResult {
  traits: BlueprintTrait[];
  newTraitApplied: boolean;
  /** Pre-RA1, dimension-grouped chip keys dropped this run. Reported so a
   * run that quietly discards someone's traits says so in the logs. */
  legacyKeysDropped: string[];
}

/** Folds this run's dominant-chip candidates into the full traits array
 * (LLM-derived traits pass through untouched). One QUESTION can only ever
 * host one active chip-trait at a time — a new dominant value replacing the
 * old one on the SAME question is a contradiction (old trait demoted, never
 * deleted outright), not a second concurrent trait. Two different questions
 * are never contradictions of each other, however much their chip values
 * look alike; that was the bug. A brand-new chip-trait (a question with no
 * prior chip-trait) is gated by its own weekly cap, independent of the LLM
 * synthesis's one-new-pattern slot — different candidate lane, same
 * scarcity philosophy, separate counter. */
export function mergeChipTraitCandidates(params: {
  previousTraits: BlueprintTrait[];
  candidates: ChipTraitCandidate[];
  nowIso: string;
}): ChipTraitMergeResult {
  const { previousTraits, candidates, nowIso } = params;

  const legacyKeysDropped: string[] = [];
  const prevChipByFamily = new Map<string, BlueprintTrait>();
  for (const t of previousTraits) {
    if (!isChipTraitKey(t.key)) continue;
    const family = familyOfChipTraitKey(t.key);
    if (family === null) legacyKeysDropped.push(t.key);
    else prevChipByFamily.set(family, t);
  }

  const nextTraits: BlueprintTrait[] = previousTraits.filter((t) => !isChipTraitKey(t.key));
  let newTraitApplied = false;
  const seenFamilies = new Set<string>();

  for (const cand of candidates) {
    const family = familyOfChipTraitKey(cand.key);
    if (family === null) continue;
    seenFamilies.add(family);
    const prev = prevChipByFamily.get(family);

    if (prev && prev.key === cand.key) {
      nextTraits.push({
        ...prev,
        confidence: Math.min(1, prev.confidence + CHIP_TRAIT_REPEAT_STEP),
        evidence_refs: cand.evidence_refs,
        last_updated_at: nowIso,
      });
      continue;
    }

    if (prev && prev.key !== cand.key) {
      nextTraits.push({
        ...prev,
        confidence: Math.max(0, prev.confidence - CHIP_TRAIT_CONTRADICTION_STEP),
        last_updated_at: nowIso,
      });
    }

    if (!newTraitApplied) {
      nextTraits.push({
        key: cand.key,
        label: cand.label,
        confidence: CHIP_TRAIT_BASE_CONFIDENCE,
        evidence_refs: cand.evidence_refs,
        first_surfaced_at: nowIso,
        last_updated_at: nowIso,
      });
      newTraitApplied = true;
    }
  }

  for (const [family, prev] of prevChipByFamily) {
    if (!seenFamilies.has(family)) nextTraits.push(prev);
  }

  return { traits: nextTraits, newTraitApplied, legacyKeysDropped };
}
