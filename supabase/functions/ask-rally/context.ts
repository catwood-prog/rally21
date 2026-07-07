// Ask Rally, part 1 — real context assembly (Rally21-Ask-Rally-Spec.md
// §3). Pure, portable logic only — no Deno imports — so this file is
// directly Jest-testable, mirroring compose-blueprint's synthesis.ts /
// index.ts split. Rendered as compact plain text, never raw JSON (spec:
// "saves ~40% tokens and reads better to the model").
//
// Several small pieces here (describeConfidence's 0.4/0.6/0.8 thresholds,
// describePattern's per-type phrasing, localDateString) are deliberate,
// documented duplicates of lib/blueprint.ts and compose-nudges' own
// helpers — a Deno edge function can't import the React Native app's
// lib/ modules, so this codebase's established convention (see
// compose-nudges' copy of PRACTICE_VERB_STARTERS) is to duplicate small,
// stable logic and keep it in sync by hand.

export function localDateString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** Counts how many of the given (already-fetched, recent, user-role)
 * message timestamps fall on `now`'s local date for this timezone — the
 * daily rate limit. Deliberately avoids converting "local midnight" to a
 * UTC instant (compose-nudges' own comment: Deno has no IANA conversion
 * library) by instead comparing each message's own local date string. */
export function countMessagesOnLocalDate(
  messageTimestamps: string[],
  timeZone: string,
  now: Date
): number {
  const today = localDateString(now, timeZone);
  return messageTimestamps.filter((ts) => localDateString(new Date(ts), timeZone) === today).length;
}

export type ConfidenceWord = "hunch" | "fairly sure" | "solid";

/** Same 0.4 floor + word bands as lib/blueprint.ts's describeConfidence —
 * kept in sync by hand (see file header). */
export function describeConfidence(confidence: number): ConfidenceWord | null {
  if (confidence < 0.4) return null;
  if (confidence < 0.6) return "hunch";
  if (confidence < 0.8) return "fairly sure";
  return "solid";
}

export interface BlueprintTraitRow {
  key: string;
  label: string;
  confidence: number;
}

export function buildTraitLines(traits: BlueprintTraitRow[]): string[] {
  return traits
    .map((t) => ({ t, word: describeConfidence(t.confidence) }))
    .filter((x): x is { t: BlueprintTraitRow; word: ConfidenceWord } => !!x.word)
    .map(({ t, word }) => `- ${word}: ${t.label}`);
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

export interface BlueprintPatternRow {
  patternType: "weekday_mood" | "time_of_day_mood" | "consistency" | "synthesis_pattern" | "synthesis_want";
  weekday: number | null;
  direction: string | null;
  cutoffHour: number | null;
  agreementCount: number;
  totalCount: number;
  statement: string | null;
}

/** Plain-text equivalent of lib/blueprint.ts's describeBlueprintPattern
 * (no headline/accent split needed here — one sentence with its evidence
 * count, since this is prose for the model, not a UI card). */
export function describePattern(p: BlueprintPatternRow): string {
  if (p.patternType === "synthesis_pattern" || p.patternType === "synthesis_want") {
    return p.statement ?? "";
  }
  if (p.patternType === "weekday_mood" && p.weekday !== null) {
    const isLow = p.direction === "low";
    return `Mood runs ${isLow ? "lowest" : "highest"} on ${WEEKDAY_NAMES[p.weekday]}s (${p.agreementCount} of their last ${p.totalCount} ${WEEKDAY_PLURAL[p.weekday]}).`;
  }
  if (p.patternType === "time_of_day_mood") {
    const beforeNoon = p.direction === "before_noon_higher";
    return `Mood runs highest on days they check in ${beforeNoon ? "before noon" : "after noon"} (${p.agreementCount} of their last ${p.totalCount} check-ins).`;
  }
  const hour = p.cutoffHour ?? 9;
  const label = hour === 0 ? "12am" : hour < 12 ? `${hour}am` : hour === 12 ? "12pm" : `${hour - 12}pm`;
  return `Most check-ins land before ${label} (${p.agreementCount} of their last ${p.totalCount}).`;
}

export function buildPatternLines(patterns: BlueprintPatternRow[]): string[] {
  return patterns.map((p) => `- ${describePattern(p)}`);
}

/** One honest sentence naming the best- and worst-covered dimensions —
 * "Coverage gaps are humility" per the template's own closing line. */
export function describeCoverage(coverage: Record<string, number>): string | null {
  const entries = Object.entries(coverage);
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const [bestDim] = sorted[0];
  const [worstDim] = sorted[sorted.length - 1];
  if (bestDim === worstDim) return `You know a moderate amount about their ${bestDim} so far.`;
  return `You know a fair amount about their ${bestDim}, little yet about their ${worstDim}.`;
}

export function buildBlueprintBlock(params: {
  traits: BlueprintTraitRow[];
  patterns: BlueprintPatternRow[];
  coverage: Record<string, number>;
}): string {
  const lines: string[] = [];
  const traitLines = buildTraitLines(params.traits);
  if (traitLines.length > 0) {
    lines.push("Traits:", ...traitLines);
  }
  const patternLines = buildPatternLines(params.patterns);
  if (patternLines.length > 0) {
    lines.push("Patterns:", ...patternLines);
  }
  const coverageLine = describeCoverage(params.coverage);
  if (coverageLine) lines.push(coverageLine);
  if (lines.length === 0) return "No blueprint patterns yet — this person is still early in their reflection history.";
  return lines.join("\n");
}

/** "climbing" (recent half clearly higher), "dipping" (clearly lower), or
 * "steady around N" — never a raw number-only reading; always words. */
export function describeMoodTrend(last7Moods: number[]): string | null {
  if (last7Moods.length === 0) return null;
  const mid = Math.floor(last7Moods.length / 2);
  const older = last7Moods.slice(0, mid || 1);
  const newer = last7Moods.slice(mid || 1);
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const overall = Math.round(avg(last7Moods) * 10) / 10;
  if (newer.length === 0 || older.length === 0) return `mood steady around ${overall}`;
  const delta = avg(newer) - avg(older);
  if (delta >= 0.5) return "mood climbing";
  if (delta <= -0.5) return "mood dipping";
  return `mood steady around ${overall}`;
}

export interface GlowState {
  glow: number;
  state: "glowing" | "embers" | "cold";
  emberDeadline: string | null;
}

export function describeGlowState(glow: GlowState | null): string | null {
  if (!glow) return null;
  if (glow.state === "glowing") return `Currently glowing at ${glow.glow} day${glow.glow === 1 ? "" : "s"}.`;
  if (glow.state === "embers") return `In embers — one check-in today rekindles it.`;
  return null; // "cold" carries no special framing; absence of a streak isn't itself a signal
}

export function buildStatesBlock(params: { last7Moods: number[]; glow: GlowState | null }): string {
  const parts: string[] = [];
  const moodTrend = describeMoodTrend(params.last7Moods);
  if (moodTrend) parts.push(moodTrend.charAt(0).toUpperCase() + moodTrend.slice(1) + ".");
  const glowLine = describeGlowState(params.glow);
  if (glowLine) parts.push(glowLine);
  if (parts.length === 0) return "No recent check-in history yet.";
  return parts.join(" ");
}

export interface ReflectionLine {
  localDate: string;
  line1: string | null;
  line2: string | null;
}

export function buildReflectionsBlock(reflections: ReflectionLine[]): string {
  if (reflections.length === 0) return "No reflections yet.";
  return reflections
    .map((r) => {
      const parts: string[] = [];
      if (r.line1) parts.push(`grateful for: "${r.line1}"`);
      if (r.line2) parts.push(`learned: "${r.line2}"`);
      return `- ${r.localDate} — ${parts.join(". ")}.`;
    })
    .join("\n");
}

export interface CircleSummary {
  practiceName: string;
  dayNumber: number;
  circleName: string;
  checkedIn: number;
  memberCount: number;
}

export function buildCircleBlock(circles: CircleSummary[]): string {
  if (circles.length === 0) return "Not currently in any active circle.";
  return circles
    .map(
      (c) =>
        `- ${c.practiceName}, day ${c.dayNumber}, circle "${c.circleName}" — ${c.checkedIn} of ${c.memberCount} checked in today.`
    )
    .join("\n");
}

/** Wants clarify (Blueprint-Notes): only while a confirmed want hasn't
 * already become a practice — once it has, "make this your next 21 days"
 * no longer applies, there's nothing left to nudge toward. */
export function buildWantsNote(params: { wantStatement: string | null; hasActivation: boolean }): string {
  if (!params.wantStatement || params.hasActivation) return "";
  return `\n\nWANTS\nThis person has a confirmed "blueprint want": "${params.wantStatement}" You may help make it more concrete if it comes up naturally, and may mention that turning it into their next 21 days is possible from the blueprint screen — but never push it or bring it up unprompted.`;
}

export function assembleAskRallySystemPrompt(params: {
  template: string;
  crisisResources: string;
  blueprintBlock: string;
  statesBlock: string;
  reflectionsBlock: string;
  circleBlock: string;
  wantsNote: string;
}): string {
  return (
    params.template
      .replace("{{crisis_resources}}", params.crisisResources)
      .replace("{{blueprint_block}}", params.blueprintBlock)
      .replace("{{states_block}}", params.statesBlock)
      .replace("{{reflections_block}}", params.reflectionsBlock)
      .replace("{{circle_block}}", params.circleBlock) + params.wantsNote
  );
}

export const DAILY_MESSAGE_LIMIT = 5;

export const RATE_LIMIT_MESSAGE =
  "That's today's five messages with me — the free tier keeps it to a handful a day. I'll be here tomorrow, same as always.";
