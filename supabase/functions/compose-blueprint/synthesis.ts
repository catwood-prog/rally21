// Blueprint v2 — the weekly LLM synthesis batch (Rally21-Blueprint-Notes.md,
// Adaptive-Intelligence-Spec §3-5). Pure, portable logic only — no Deno
// imports here so this file is directly Jest-testable (mirrors ask-rally's
// system-prompt.ts split between logic and Deno wiring).
//
// blueprint_versions.content shape (approved 7 July): traits/patterns/wants
// arrays plus a coverage map and a permanent rejected_statements list. This
// document is read by THREE future consumers (B3's screen, A1's context
// assembly, Q1's coverage_gap) — field names are stable by design.

export type PatternStatus = "surfaced" | "confirmed" | "rejected";

export interface BlueprintTrait {
  key: string;
  label: string;
  confidence: number;
  evidence_refs: string[];
  first_surfaced_at: string;
  last_updated_at: string;
}

export interface BlueprintPatternEntry {
  key: string;
  statement: string;
  evidence_dates: string[];
  status: PatternStatus;
  source: "synthesis";
  first_surfaced_at: string;
  last_updated_at: string;
}

export interface BlueprintWant {
  key: string;
  statement: string;
  evidence_refs: string[];
  status: PatternStatus;
  confirmed_at: string | null;
}

export interface BlueprintGeneratedFrom {
  reflections_through: string | null;
  completions_through: string | null;
  is_backfill: boolean;
}

export interface BlueprintContent {
  traits: BlueprintTrait[];
  patterns: BlueprintPatternEntry[];
  wants: BlueprintWant[];
  coverage: Record<string, number>;
  rejected_statements: string[];
  generated_from: BlueprintGeneratedFrom;
}

export function emptyBlueprintContent(generatedFrom: BlueprintGeneratedFrom): BlueprintContent {
  return { traits: [], patterns: [], wants: [], coverage: {}, rejected_statements: [], generated_from: generatedFrom };
}

// ---------------------------------------------------------------------
// Pseudonymized input — the ONLY shape allowed onto the Anthropic prompt.
// Deliberately narrow: there is no field here a caller could accidentally
// populate with a name, email, or user id, because the type doesn't have
// one. pseudonymizeInput() is the single seam between raw DB rows (which
// carry user_id) and everything downstream.
// ---------------------------------------------------------------------

export interface PseudonymizedReflection {
  local_date: string;
  mood: number | null;
  line1: string | null;
  line2: string | null;
  question_dimension: string | null;
  question_answer: string | null;
}

export interface PseudonymizedResponse {
  pattern_key: string;
  response: "confirmed" | "not_quite";
  note: string | null;
}

export interface SynthesisInput {
  reflections: PseudonymizedReflection[];
  completion_dates: string[];
  responses: PseudonymizedResponse[];
}

export function pseudonymizeInput(raw: {
  reflections: Array<{
    local_date: string;
    mood: number | null;
    line1: string | null;
    line2: string | null;
    question_dimension?: string | null;
    question_answer?: string | null;
  }>;
  completions: Array<{ local_date: string }>;
  responses: Array<{ pattern_key: string; response: "confirmed" | "not_quite"; note: string | null }>;
}): SynthesisInput {
  return {
    reflections: raw.reflections.map((r) => ({
      local_date: r.local_date,
      mood: r.mood ?? null,
      line1: r.line1 ?? null,
      line2: r.line2 ?? null,
      question_dimension: r.question_dimension ?? null,
      question_answer: r.question_answer ?? null,
    })),
    completion_dates: raw.completions.map((c) => c.local_date),
    responses: raw.responses.map((r) => ({ pattern_key: r.pattern_key, response: r.response, note: r.note ?? null })),
  };
}

// ---------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------

export interface SynthesisContext {
  existingPatternKeys: string[];
  hasActiveWant: boolean;
  rejectedStatements: string[];
  isFirstSynthesis: boolean;
}

export const SYNTHESIS_SYSTEM_PROMPT = `You analyze one person's private reflection history for Rally21, a small habit-circle app, to surface gentle self-observations ("blueprint" patterns). You never see their name, email, or any identifying information — only dates, moods (1-5), two short daily reflection lines (what they were grateful for, what they learned), occasional answers to open questions tagged by dimension (ENR=energy, MOOD, STR=stress, MOT=motivation, SELF, CON=consistency, VAL=values, HAB=habits), and check-in dates.

Your job: propose at most ONE new pattern, estimates for a small set of traits, and — only if invited — one "want": something this person keeps reaching for, distilled from VAL-dimension answers and reflections.

Rules, non-negotiable:
- Never propose a pattern or want whose statement matches (even loosely) one already in "rejected_statements" — this person told Rally that observation was wrong, permanently. Never propose a pattern whose key is already in "existing_pattern_keys" either — that one already exists, you're not re-surfacing it.
- Never propose a pattern or want with fewer than 5 supporting dates as evidence — a single mention proves nothing.
- Prioritize gratitude patterns when the evidence supports them (e.g. "when you're grateful, it's almost always about people, not things") — these are the richest, most reliable signal here.
- Reflection line text is corroborating context only, never a standalone signal — never invent a pattern from a single reflective sentence with no repeated evidence across multiple dates.
- Traits are a slow-moving read of the person (e.g. "consistency-driven", "socially motivated"), each with a confidence 0-1. If you're updating a trait you've seen before, move its confidence gently — large swings are your own uncertainty, not insight.
- If "can_propose_want" is false, always return want: null — this person already has an unresolved want, and only they can resolve it, not a new proposal from you.
- Tone: warm, plain, never clinical. For wants, never say "goal" or "goal-setting" — use phrasing like "what you're reaching for". Never guilt, never scold, never imply a missed day is evidence of anything.
- Output STRICT JSON matching this shape, nothing else — no markdown fences, no commentary before or after:
{"traits": [{"key": "snake_case_key", "label": "short human label", "confidence": 0.0, "evidence_refs": ["YYYY-MM-DD"]}], "new_pattern": {"key": "snake_case_key", "statement": "one warm sentence", "evidence_dates": ["YYYY-MM-DD"]} or null, "want": {"key": "snake_case_key", "statement": "one warm sentence, e.g. starting with 'You keep reaching for...'", "evidence_refs": ["YYYY-MM-DD"]} or null, "coverage": {"energy": 0.0, "values": 0.0, "habits": 0.0, "mood": 0.0, "relationships": 0.0}}
"coverage" is your own honest 0-1 estimate of how much signal you actually have on this person along each dimension given the data provided — used only to decide what to ask them next, never shown to them directly.`;

export function buildSynthesisPrompt(input: SynthesisInput, context: SynthesisContext): { system: string; user: string } {
  const user = JSON.stringify({
    reflections: input.reflections,
    completion_dates: input.completion_dates,
    corrections: input.responses,
    existing_pattern_keys: context.existingPatternKeys,
    rejected_statements: context.rejectedStatements,
    can_propose_want: !context.hasActiveWant,
    is_first_synthesis: context.isFirstSynthesis,
  });
  return { system: SYNTHESIS_SYSTEM_PROMPT, user };
}

// ---------------------------------------------------------------------
// Model output parsing — a malformed response fails safe (caller keeps
// the previous blueprint_versions row and moves to the next user).
// ---------------------------------------------------------------------

export interface SynthesisTraitProposal {
  key: string;
  label: string;
  confidence: number;
  evidence_refs: string[];
}

export interface SynthesisPatternProposal {
  key: string;
  statement: string;
  evidence_dates: string[];
}

export interface SynthesisWantProposal {
  key: string;
  statement: string;
  evidence_refs: string[];
}

export interface SynthesisProposal {
  traits: SynthesisTraitProposal[];
  new_pattern: SynthesisPatternProposal | null;
  want: SynthesisWantProposal | null;
  coverage: Record<string, number>;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isValidTraitProposal(v: any): v is SynthesisTraitProposal {
  return (
    v && typeof v === "object" &&
    isNonEmptyString(v.key) && isNonEmptyString(v.label) &&
    typeof v.confidence === "number" && v.confidence >= 0 && v.confidence <= 1 &&
    isStringArray(v.evidence_refs)
  );
}

function isValidPatternProposal(v: any): v is SynthesisPatternProposal {
  return v && typeof v === "object" && isNonEmptyString(v.key) && isNonEmptyString(v.statement) && isStringArray(v.evidence_dates);
}

function isValidWantProposal(v: any): v is SynthesisWantProposal {
  return v && typeof v === "object" && isNonEmptyString(v.key) && isNonEmptyString(v.statement) && isStringArray(v.evidence_refs);
}

function isValidCoverage(v: any): v is Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v).every((n) => typeof n === "number" && n >= 0 && n <= 1);
}

/** Strips a leading/trailing markdown code fence if the model added one
 * despite instructions not to — cheap resilience, not a schema relaxation. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

export function parseSynthesisProposal(rawText: string): SynthesisProposal | null {
  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (!Array.isArray(parsed.traits) || !parsed.traits.every(isValidTraitProposal)) return null;
  if (parsed.new_pattern !== null && !isValidPatternProposal(parsed.new_pattern)) return null;
  if (parsed.want !== null && !isValidWantProposal(parsed.want)) return null;
  if (!isValidCoverage(parsed.coverage)) return null;
  return {
    traits: parsed.traits,
    new_pattern: parsed.new_pattern,
    want: parsed.want,
    coverage: parsed.coverage,
  };
}

// ---------------------------------------------------------------------
// Reconciliation + merge — the actual rule enforcement lives here, in
// deterministic code, not in trusting the model to self-police numeric
// constraints. The model's proposal is a candidate; this is the gate.
// ---------------------------------------------------------------------

const MIN_EVIDENCE = 5;
const MAX_TRAIT_DELTA = 0.1;

function statementsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function isRejectedStatement(statement: string, rejected: string[]): boolean {
  return rejected.some((r) => statementsMatch(r, statement));
}

/** Applies any new confirm/not-quite responses since the last run: a
 * not_quite retires the pattern/want and (spec: "store rejected
 * STATEMENTS permanently") banks its statement text so no future
 * synthesis run — this week or any week — proposes it again. */
export function reconcileResponses(
  previous: BlueprintContent,
  responses: PseudonymizedResponse[]
): BlueprintContent {
  const latestResponseByKey = new Map<string, "confirmed" | "not_quite">();
  for (const r of responses) latestResponseByKey.set(r.pattern_key, r.response);

  const rejectedStatements = [...previous.rejected_statements];
  const banStatement = (statement: string) => {
    if (!isRejectedStatement(statement, rejectedStatements)) rejectedStatements.push(statement.trim());
  };

  const patterns = previous.patterns.map((p) => {
    const resp = latestResponseByKey.get(p.key);
    if (resp === "not_quite" && p.status !== "rejected") {
      banStatement(p.statement);
      return { ...p, status: "rejected" as PatternStatus };
    }
    if (resp === "confirmed" && p.status === "surfaced") {
      return { ...p, status: "confirmed" as PatternStatus };
    }
    return p;
  });

  const wants = previous.wants.map((w) => {
    const resp = latestResponseByKey.get(w.key);
    if (resp === "not_quite" && w.status !== "rejected") {
      banStatement(w.statement);
      return { ...w, status: "rejected" as PatternStatus };
    }
    if (resp === "confirmed" && w.status === "surfaced") {
      return { ...w, status: "confirmed" as PatternStatus };
    }
    return w;
  });

  return { ...previous, patterns, wants, rejected_statements: rejectedStatements };
}

export interface MergeResult {
  content: BlueprintContent;
  appliedNewPattern: boolean;
  appliedWant: boolean;
  droppedForEvidence: string[];
  droppedForRejected: string[];
  clampedTraits: string[];
}

export function mergeSynthesisProposal(params: {
  previous: BlueprintContent;
  proposal: SynthesisProposal;
  nowIso: string;
  generatedFrom: BlueprintGeneratedFrom;
}): MergeResult {
  const { previous, proposal, nowIso, generatedFrom } = params;
  const droppedForEvidence: string[] = [];
  const droppedForRejected: string[] = [];
  const clampedTraits: string[] = [];

  // Traits: brand-new traits are gated on the evidence bar; traits we
  // already track can only move confidence by MAX_TRAIT_DELTA per run,
  // regardless of what the model proposed.
  const prevTraitByKey = new Map(previous.traits.map((t) => [t.key, t]));
  const traits: BlueprintTrait[] = [];
  for (const proposed of proposal.traits) {
    const prev = prevTraitByKey.get(proposed.key);
    if (!prev) {
      if (proposed.evidence_refs.length < MIN_EVIDENCE) {
        droppedForEvidence.push(proposed.key);
        continue;
      }
      traits.push({
        key: proposed.key,
        label: proposed.label,
        confidence: Math.max(0, Math.min(1, proposed.confidence)),
        evidence_refs: proposed.evidence_refs,
        first_surfaced_at: nowIso,
        last_updated_at: nowIso,
      });
      continue;
    }
    const clamped = Math.max(prev.confidence - MAX_TRAIT_DELTA, Math.min(prev.confidence + MAX_TRAIT_DELTA, proposed.confidence));
    if (Math.abs(proposed.confidence - prev.confidence) > MAX_TRAIT_DELTA) clampedTraits.push(proposed.key);
    traits.push({
      key: prev.key,
      label: proposed.label || prev.label,
      confidence: clamped,
      evidence_refs: proposed.evidence_refs.length > 0 ? proposed.evidence_refs : prev.evidence_refs,
      first_surfaced_at: prev.first_surfaced_at,
      last_updated_at: nowIso,
    });
  }
  for (const prev of previous.traits) {
    if (!traits.some((t) => t.key === prev.key)) traits.push(prev);
  }

  // Patterns: carry forward everything (reconcileResponses already
  // applied this week's confirm/not_quite), then consider the single
  // new_pattern candidate — scarcity (spec: "at most ONE newly surfaced
  // pattern per user per week") enforced by the schema itself, since the
  // model can only propose one at all.
  const patterns: BlueprintPatternEntry[] = [...previous.patterns];
  let appliedNewPattern = false;
  if (proposal.new_pattern) {
    const np = proposal.new_pattern;
    const alreadyExists = previous.patterns.some((p) => p.key === np.key);
    if (!alreadyExists) {
      if (isRejectedStatement(np.statement, previous.rejected_statements)) {
        droppedForRejected.push(np.key);
      } else if (np.evidence_dates.length < MIN_EVIDENCE) {
        droppedForEvidence.push(np.key);
      } else {
        patterns.push({
          key: np.key,
          statement: np.statement,
          evidence_dates: np.evidence_dates,
          status: "surfaced",
          source: "synthesis",
          first_surfaced_at: nowIso,
          last_updated_at: nowIso,
        });
        appliedNewPattern = true;
      }
    }
  }

  // Wants: one active want at a time.
  const wants: BlueprintWant[] = [...previous.wants];
  let appliedWant = false;
  const hasActiveWant = previous.wants.some((w) => w.status !== "rejected");
  if (proposal.want && !hasActiveWant) {
    const w = proposal.want;
    if (isRejectedStatement(w.statement, previous.rejected_statements)) {
      droppedForRejected.push(w.key);
    } else if (w.evidence_refs.length < MIN_EVIDENCE) {
      droppedForEvidence.push(w.key);
    } else {
      wants.push({ key: w.key, statement: w.statement, evidence_refs: w.evidence_refs, status: "surfaced", confirmed_at: null });
      appliedWant = true;
    }
  }

  const content: BlueprintContent = {
    traits,
    patterns,
    wants,
    coverage: Object.keys(proposal.coverage).length > 0 ? proposal.coverage : previous.coverage,
    rejected_statements: previous.rejected_statements,
    generated_from: generatedFrom,
  };

  return { content, appliedNewPattern, appliedWant, droppedForEvidence, droppedForRejected, clampedTraits };
}

/** The full per-user pipeline: reconcile this run's new confirm/not_quite
 * responses into the previous document, then merge the model's proposal
 * on top of the reconciled (not the raw previous) state — so a pattern
 * rejected moments ago is already excluded from "already exists" carry-
 * forward and its statement is already banned for the merge's own
 * rejected-statement check. */
export function synthesizeNextContent(params: {
  previous: BlueprintContent;
  responses: PseudonymizedResponse[];
  proposal: SynthesisProposal;
  nowIso: string;
  generatedFrom: BlueprintGeneratedFrom;
}): MergeResult {
  const reconciled = reconcileResponses(params.previous, params.responses);
  return mergeSynthesisProposal({
    previous: reconciled,
    proposal: params.proposal,
    nowIso: params.nowIso,
    generatedFrom: params.generatedFrom,
  });
}
