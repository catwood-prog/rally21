// Q1's deterministic lane (Rally21-Question-Engine-Spec.md §4) — chip
// answers become trait candidates through pure repeat-detection, zero
// LLM cost. "Family" (checkpoint b, 7 July): grouped by dimension +
// recurring chip VALUE, not by specific question id — exact-question
// repeats are already 30+ days apart (the selection engine's own
// repeat-exclusion filter), so the same literal question can't recur
// 4 times in any reasonable window; dimension + chip value is the only
// grouping that can realistically accumulate "3 of last 4."
//
// Writes into the SAME blueprint_versions.content.traits array the LLM
// synthesis (synthesis.ts) writes to — "your deterministic lane writes
// THERE, one blueprint, not a parallel store" (spec §4). Chip-derived
// trait keys are namespaced `chip_<dimension>_<value-slug>` so they can
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
  dimension: string;
  chip_value: string;
}

export interface ChipTraitCandidate {
  key: string;
  label: string;
  dimension: string;
  chipValue: string;
  evidence_refs: string[];
}

export function chipTraitKey(dimension: string, chipValue: string): string {
  const slug = chipValue
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `chip_${dimension.toLowerCase()}_${slug}`;
}

function isChipTraitKey(key: string): boolean {
  return key.startsWith("chip_");
}

/** dimension a chip-trait key belongs to, read back out of the key
 * itself — the key is the only place this module stores it. */
function dimensionOfChipTraitKey(key: string): string {
  return key.split("_")[1] ?? "";
}

/** Per dimension, the last CHIP_TRAIT_WINDOW chip-format asks (any
 * question, same family by dimension) — if one chip value dominates
 * >=CHIP_TRAIT_MIN_EVIDENCE of that window, it's a candidate. */
export function findDominantChipCandidates(answers: ChipAnswer[]): ChipTraitCandidate[] {
  const byDimension = new Map<string, ChipAnswer[]>();
  for (const a of answers) {
    const list = byDimension.get(a.dimension) ?? [];
    list.push(a);
    byDimension.set(a.dimension, list);
  }

  const candidates: ChipTraitCandidate[] = [];
  for (const [dimension, rows] of byDimension) {
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
        key: chipTraitKey(dimension, bestValue),
        label: bestValue,
        dimension,
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
}

/** Folds this run's dominant-chip candidates into the full traits array
 * (LLM-derived traits pass through untouched). One dimension can only
 * ever host one active chip-trait at a time — a new dominant value
 * replacing the old one is a contradiction (old trait demoted, never
 * deleted outright), not a second concurrent trait for the same
 * dimension. A brand-new chip-trait (a dimension with no prior
 * chip-trait) is gated by its own weekly cap, independent of the LLM
 * synthesis's one-new-pattern slot — different candidate lane, same
 * scarcity philosophy, separate counter. */
export function mergeChipTraitCandidates(params: {
  previousTraits: BlueprintTrait[];
  candidates: ChipTraitCandidate[];
  nowIso: string;
}): ChipTraitMergeResult {
  const { previousTraits, candidates, nowIso } = params;

  const prevChipByDimension = new Map<string, BlueprintTrait>();
  for (const t of previousTraits) {
    if (isChipTraitKey(t.key)) prevChipByDimension.set(dimensionOfChipTraitKey(t.key), t);
  }

  const nextTraits: BlueprintTrait[] = previousTraits.filter((t) => !isChipTraitKey(t.key));
  let newTraitApplied = false;
  const seenDimensions = new Set<string>();

  for (const cand of candidates) {
    const dimKey = cand.dimension.toLowerCase();
    seenDimensions.add(dimKey);
    const prev = prevChipByDimension.get(dimKey);

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

  for (const [dim, prev] of prevChipByDimension) {
    if (!seenDimensions.has(dim)) nextTraits.push(prev);
  }

  return { traits: nextTraits, newTraitApplied };
}
