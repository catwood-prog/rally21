// MN3 — contrast cards: "in your words" beside "what we've seen", where the
// two disagree. Pure, portable logic only, no Deno imports, so this file is
// directly Jest-testable (the same split synthesis.ts uses).
//
// THE HALLUCINATION LAW IS THIS FILE'S ARCHITECTURE, not its instructions.
// Cat's own words on the stakes: a hallucinated claim about a person "would
// put the whole app at risk." So:
//
//   1. The model never computes a fact. Every number, date and quoted word
//      arrives from SQL (detect_contrast_candidates) as a fact sheet. The
//      model SELECTS which candidate to speak to and PHRASES one sentence.
//   2. Detection ran on structured chip answers only. short_text never
//      reaches here — it may be quoted verbatim, never detected on.
//   3. validateContrastProposal() below runs before anything is stored:
//      the quote must byte-equal the stored answer, every number in the
//      model's sentence must be one the SQL computed, and the date must be
//      one of the supplied ones. A failing card is DROPPED and logged.
//      Never repaired, never regenerated toward compliance. A silent week
//      is a fine outcome.
//   4. The card's EVIDENCE is not model text: the numbers ride in the
//      stored card as structured fields and the client composes the
//      evidence line from them, the existing pattern-card convention.

import { BlueprintContent, ContrastEntry } from "./synthesis.ts";

export type { ContrastEntry };

/** One candidate, exactly as detect_contrast_candidates returns it. Every
 * factual element a card is allowed to contain is a field here — if a claim
 * cannot be traced to one of these, it cannot be made. */
export interface ContrastFactSheet {
  question_code: string;
  metric_key: string;
  declared_value: string;
  declared_answer: string;
  declared_date: string;
  declared_dates: string[];
  declared_of_last: number;
  window_start: string;
  window_end: string;
  observed_days: number;
  weekend_days: number;
  weekend_checkins: number;
  weekday_days: number;
  weekday_checkins: number;
  weekend_rate: number;
  weekday_rate: number;
  gap: number;
  disagreement: "weekends_quieter" | "weekends_holding";
}

/** What the model is allowed to return. Three fields, two of which are
 * copied rather than composed. */
export interface ContrastProposal {
  question_code: string;
  declared_quote: string;
  declared_date: string;
  observed_line: string;
}

/** The pattern_key IS the contrast pair — question, declared value, metric.
 * That is what makes "a not-quite pins the PAIR" true for free: a reworded
 * card making the same claim carries the same key, so the existing
 * rejected-pattern machinery blocks it without knowing anything about
 * contrasts. */
export function contrastKey(questionCode: string, declaredValue: string, metricKey: string): string {
  const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `contrast_${slug(questionCode)}_${slug(declaredValue)}_${slug(metricKey)}`;
}

// ---------------------------------------------------------------------
// Prompt assembly. The model gets facts and a very small job.
// ---------------------------------------------------------------------

export const CONTRAST_SYSTEM_PROMPT =
  `You write ONE sentence for Rally21, a small habit-circle app, and nothing else.

A person answered the same question about themselves three or four times in a row the same way. Separately, their check-in record points the other way. You are shown both, already measured. Your job is to phrase what the record shows, in one plain sentence, so they can look at the two side by side and decide for themselves.

You are given a fact sheet. You may not compute, estimate, infer or round anything. Every number you write must appear in the fact sheet exactly as given. If you cannot write the sentence using only those numbers, write it using none.

Rules, non-negotiable:
- ONE sentence, lowercase start, no more than about 16 words.
- Describe the RECORD, never the person. "your weekends have been quieter than your weekdays lately" is the voice. Anything shaped like "you are", "you tend to be", or a type or label, is banned.
- Never correct them. The words "actually", "in fact", "but you", "despite" and "contrary" are banned. This card asks, it does not argue.
- Never mention what they said. The card shows their own words directly above your sentence; repeating it back is what makes a card read as a rebuttal.
- No dates in your sentence. No em dashes, use commas.
- Never imply a missed day is a failing, and never guess why.
- Copy declared_quote and declared_date across from the fact sheet EXACTLY, character for character. Do not tidy, capitalise, or punctuate them.
- Output STRICT JSON, nothing else, no markdown fences, no commentary:
{"question_code": "...", "declared_quote": "...", "declared_date": "YYYY-MM-DD", "observed_line": "..."}`;

export function buildContrastPrompt(candidates: ContrastFactSheet[]): { system: string; user: string } {
  return {
    system: CONTRAST_SYSTEM_PROMPT,
    user: JSON.stringify({ candidates }),
  };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

export function parseContrastProposal(rawText: string): ContrastProposal | null {
  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const fields = ["question_code", "declared_quote", "declared_date", "observed_line"];
  for (const f of fields) {
    if (typeof parsed[f] !== "string" || parsed[f].length === 0) return null;
  }
  return {
    question_code: parsed.question_code,
    declared_quote: parsed.declared_quote,
    declared_date: parsed.declared_date,
    observed_line: parsed.observed_line,
  };
}

// ---------------------------------------------------------------------
// THE VALIDATOR — clause 3, and the only thing standing between a model's
// sentence and a claim about a person. Reasoning about it is not proof;
// its unit suite hands it deliberately corrupted cards.
// ---------------------------------------------------------------------

export type ContrastRejection =
  | "unknown_candidate"
  | "misquoted_declaration"
  | "invented_evidence_ref"
  | "invented_number"
  | "banned_register"
  | "em_dash"
  | "empty_line"
  | "too_long";

/** Phrases that turn an offer into a verdict. Checked as substrings on the
 * lowercased line, so no amount of surrounding wording smuggles one in. */
const BANNED_PHRASES = [
  "actually",
  "in fact",
  "but you",
  "despite",
  "contrary",
  "you are",
  "you're a",
  "you tend to be",
  "introvert",
  "extrovert",
  "personality",
];

const MAX_OBSERVED_WORDS = 20;

/** Every number the model is permitted to write, as strings. Anything else
 * with a digit in it is a number it made up, whatever it looks like. */
export function allowedNumbers(sheet: ContrastFactSheet): Set<string> {
  const pct = (rate: number) => String(Math.round(rate * 100));
  return new Set([
    String(sheet.weekend_checkins),
    String(sheet.weekend_days),
    String(sheet.weekday_checkins),
    String(sheet.weekday_days),
    String(sheet.observed_days),
    String(sheet.declared_of_last),
    pct(sheet.weekend_rate),
    pct(sheet.weekday_rate),
    pct(Math.abs(sheet.gap)),
  ]);
}

export function validateContrastProposal(
  proposal: ContrastProposal,
  candidates: ContrastFactSheet[]
): { ok: true; sheet: ContrastFactSheet } | { ok: false; reason: ContrastRejection } {
  const sheet = candidates.find((c) => c.question_code === proposal.question_code);
  // It answered about a question we never offered it.
  if (!sheet) return { ok: false, reason: "unknown_candidate" };

  // Byte equality, deliberately not trimmed or case-folded: the card shows
  // this string inside quotation marks as the person's own word.
  if (proposal.declared_quote !== sheet.declared_answer) {
    return { ok: false, reason: "misquoted_declaration" };
  }

  // Clause 3's evidence refs: the only dates that exist are the ones the
  // person actually answered on.
  if (!sheet.declared_dates.includes(proposal.declared_date)) {
    return { ok: false, reason: "invented_evidence_ref" };
  }

  const line = proposal.observed_line.trim();
  if (line.length === 0) return { ok: false, reason: "empty_line" };
  if (line.split(/\s+/).length > MAX_OBSERVED_WORDS) return { ok: false, reason: "too_long" };
  if (line.includes("—") || line.includes("–")) return { ok: false, reason: "em_dash" };

  const lower = line.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) return { ok: false, reason: "banned_register" };
  }

  const permitted = allowedNumbers(sheet);
  for (const run of line.match(/\d+/g) ?? []) {
    if (!permitted.has(run)) return { ok: false, reason: "invented_number" };
  }

  return { ok: true, sheet };
}

// ---------------------------------------------------------------------
// Merge into the blueprint document.
// ---------------------------------------------------------------------

export type ContrastSkip =
  | "already_exists"
  | "open_card_pending"
  | "rejected_statement";

export interface ContrastMergeResult {
  contrasts: ContrastEntry[];
  applied: boolean;
  skipped: ContrastSkip | null;
}

function statementsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function mergeContrastCard(params: {
  previous: BlueprintContent;
  sheet: ContrastFactSheet;
  proposal: ContrastProposal;
  nowIso: string;
}): ContrastMergeResult {
  const { previous, sheet, proposal, nowIso } = params;
  const existing = previous.contrasts ?? [];
  const key = contrastKey(sheet.question_code, sheet.declared_value, sheet.metric_key);

  // The pair has been shown before, in any state. A confirmed one has been
  // said; a rejected one was told to us to stop; a surfaced one is still
  // sitting on their map waiting for an answer.
  if (existing.some((c) => c.key === key)) {
    return { contrasts: existing, applied: false, skipped: "already_exists" };
  }

  // One open contrast at a time, cohort-wide scarcity on top of the weekly
  // budget the caller already enforces.
  if (existing.some((c) => c.status === "surfaced")) {
    return { contrasts: existing, applied: false, skipped: "open_card_pending" };
  }

  if (previous.rejected_statements.some((r) => statementsMatch(r, proposal.observed_line))) {
    return { contrasts: existing, applied: false, skipped: "rejected_statement" };
  }

  const entry: ContrastEntry = {
    key,
    question_code: sheet.question_code,
    metric_key: sheet.metric_key,
    declared_value: sheet.declared_value,
    declared_quote: proposal.declared_quote,
    declared_date: proposal.declared_date,
    declared_of_last: sheet.declared_of_last,
    observed_line: proposal.observed_line.trim(),
    window_start: sheet.window_start,
    window_end: sheet.window_end,
    weekend_days: sheet.weekend_days,
    weekend_checkins: sheet.weekend_checkins,
    weekday_days: sheet.weekday_days,
    weekday_checkins: sheet.weekday_checkins,
    status: "surfaced",
    source: "contrast",
    first_surfaced_at: nowIso,
    last_updated_at: nowIso,
  };

  return { contrasts: [...existing, entry], applied: true, skipped: null };
}

/** Vulnerable-day gating, inherited from the question engine's own
 * definition rather than reinvented: no check-in yesterday, or a mood of 2
 * or less on either of the last two days. A day someone is having a hard
 * time is not the day to hand them a card about themselves. */
export function isVulnerableDay(params: {
  missedYesterday: boolean;
  lowMoodRecently: boolean;
}): boolean {
  return params.missedYesterday || params.lowMoodRecently;
}

export type ContrastGate = "ok" | "switch_off" | "weekly_budget_spent" | "vulnerable_day";

/** THE SCARCITY GATE, as a function rather than an `if`, so "a week never
 * carries a contrast AND a new pattern together" is something a test can
 * hold rather than something a reader has to trace. The budget is SHARED
 * with the LLM's one new pattern per week and is never added to: if the
 * synthesis pass already surfaced a pattern, this week is spent. */
export function contrastGate(params: {
  enabled: boolean;
  appliedNewPattern: boolean;
  vulnerable: boolean;
}): ContrastGate {
  if (!params.enabled) return "switch_off";
  if (params.appliedNewPattern) return "weekly_budget_spent";
  if (params.vulnerable) return "vulnerable_day";
  return "ok";
}

// A not_quite on a contrast is reconciled by synthesis.ts's
// reconcileResponses, alongside patterns and wants, so a correction is
// applied by the one function that owns corrections and the statement ban
// cannot be forgotten on this lane.
