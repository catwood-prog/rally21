import { STRINGS } from '@/constants/strings';

import { stripAccentMarkers } from './accentMarkup';
import { BlueprintPattern, describeBlueprintPattern, getMyBlueprint } from './blueprint';
import { supabase } from './supabase';

/** MN2 — "how you work": the manual that assembles itself out of the
 * one-question-a-day loop. Nothing here synthesises anything. The two
 * lanes are fetched separately, labelled separately, and rendered
 * adjacently; the memo's §3 lane law is that they are NEVER merged, and
 * the "you said X but we saw Y" insight is explicitly out of v1 (§8b).
 */

/** The v1 sections, exactly the four MN1 wrote into questions.manual_section
 * (plus null, which simply never reaches a section). Order is the reading
 * order on the screen and in the export. */
export const MANUAL_SECTIONS = [
  'energy-recovery',
  'connection',
  'overwhelm-restore',
  'misread',
] as const;

export type ManualSectionKey = (typeof MANUAL_SECTIONS)[number];

/** One tagged declaration question the person has answered, latest first.
 * `earlier` holds the same question's older answers, which the screen puts
 * behind a quiet expander rather than a wall of history. */
export type ManualEntry = {
  questionCode: string;
  question: string;
  whyWeAsk: string | null;
  answer: string;
  localDate: string;
  earlier: { answer: string; localDate: string }[];
};

export type ManualObservation = {
  patternKey: string;
  text: string;
  evidence: string;
};

export type ManualSection = {
  key: ManualSectionKey;
  entries: ManualEntry[];
  observations: ManualObservation[];
};

export type Manual = {
  sections: ManualSection[];
  /** True when the person has answered nothing and we have observed
   * nothing — the whole-screen empty state, not a per-section one. */
  isEmpty: boolean;
};

/** WHAT WE'VE SEEN: which blueprint pattern types are honestly ABOUT a
 * given manual section.
 *
 * This is deliberately sparse, and two sections get nothing at all:
 *   - `connection` has no entry because no pattern type observes circle
 *     behaviour yet. The memo calls connection the flagship lane (waves,
 *     hearts, quiet weeks) but that detector does not exist; claiming one
 *     of the mood patterns spoke to connection would be inventing it.
 *   - `misread` has no entry for the same reason, and MN1 gave it only two
 *     feeder questions besides.
 *   - synthesis_pattern / synthesis_want are LLM-written free text with no
 *     dimension tag. Deciding which section one belongs to would BE the
 *     synthesis work v1 excludes, so they stay on the private map where
 *     they already live and never appear here.
 *
 * The prompt's instruction where no clean mapping exists is to leave the
 * block out and say so, which is what the gaps above are.
 */
const PATTERN_SECTION: Partial<Record<BlueprintPattern['patternType'], ManualSectionKey>> = {
  // Both are literally about when in the day you show up and how your mood
  // tracks that — an energy rhythm, which is what the section is.
  time_of_day_mood: 'energy-recovery',
  consistency: 'energy-recovery',
  // The one judgement call, flagged as such in the handoff: "your mood runs
  // lowest on Mondays" is a recurring dip, which reads as a sign of when
  // things get heavy rather than as a recovery rhythm.
  weekday_mood: 'overwhelm-restore',
};

type ManualRow = {
  local_date: string;
  question_answer: string | null;
  question_prompt_snapshot: string | null;
  questions: {
    code: string | null;
    prompt: string;
    manual_section: string | null;
    why_we_ask: string | null;
  } | null;
};

/** Group answered declaration questions into entries, latest answer first.
 * Rows must arrive newest-first; the first row seen for a question is the
 * current answer and every later one is history. Exported for its test. */
export function buildEntries(rows: ManualRow[]): Map<ManualSectionKey, ManualEntry[]> {
  const bySection = new Map<ManualSectionKey, ManualEntry[]>();
  const byQuestion = new Map<string, ManualEntry>();

  for (const row of rows) {
    const q = row.questions;
    const answer = row.question_answer?.trim();
    if (!q?.code || !answer) continue;
    const section = q.manual_section as ManualSectionKey | null;
    if (!section || !MANUAL_SECTIONS.includes(section)) continue;

    const existing = byQuestion.get(q.code);
    if (existing) {
      existing.earlier.push({ answer, localDate: row.local_date });
      continue;
    }

    const entry: ManualEntry = {
      questionCode: q.code,
      // The wording this person was actually shown that day, not the
      // bank's current wording — same honesty rule as the journal's.
      question: stripAccentMarkers(row.question_prompt_snapshot ?? q.prompt),
      whyWeAsk: q.why_we_ask,
      answer,
      localDate: row.local_date,
      earlier: [],
    };
    byQuestion.set(q.code, entry);
    const list = bySection.get(section);
    if (list) list.push(entry);
    else bySection.set(section, [entry]);
  }

  return bySection;
}

/** Blueprint patterns that have an honest home in a section, grouped.
 * Anything unmapped is simply absent. Exported for its test. */
export function buildObservations(
  patterns: BlueprintPattern[]
): Map<ManualSectionKey, ManualObservation[]> {
  const bySection = new Map<ManualSectionKey, ManualObservation[]>();

  for (const pattern of patterns) {
    const section = PATTERN_SECTION[pattern.patternType];
    if (!section) continue;
    const copy = describeBlueprintPattern(pattern);
    // Referenced from the existing pattern data, never rebuilt: the same
    // describeBlueprintPattern the private map renders.
    const text = copy.accent ? `${copy.headline} ${copy.accent}.` : copy.headline;
    if (!text.trim()) continue;
    const observation = { patternKey: pattern.patternKey, text, evidence: copy.evidence };
    const list = bySection.get(section);
    if (list) list.push(observation);
    else bySection.set(section, [observation]);
  }

  return bySection;
}

export function assembleManual(
  rows: ManualRow[],
  patterns: BlueprintPattern[]
): Manual {
  const entries = buildEntries(rows);
  const observations = buildObservations(patterns);

  // Render only sections that exist in data (JOB 1). A section with
  // neither lane populated never appears at all, which is also why the
  // near-empty `misread` section needs no special empty state of its own.
  const sections = MANUAL_SECTIONS.map((key) => ({
    key,
    entries: entries.get(key) ?? [],
    observations: observations.get(key) ?? [],
  })).filter((s) => s.entries.length > 0 || s.observations.length > 0);

  return { sections, isEmpty: sections.length === 0 };
}

/** JOB 3 — the only way anything leaves the app: plain readable text a
 * person could paste anywhere, in the same family as EX1's chat export
 * (labelled parts, blank line between them, one quiet footer, no markdown
 * and no timestamps). The two lanes stay labelled and separate here too —
 * an export that merged them would undo the memo's law on its way out the
 * door. A section with an empty lane omits that lane rather than printing
 * a header over nothing. */
export function formatManualExport(
  manual: Manual,
  formatDate: (localDate: string) => string
): string {
  const blocks: string[] = [STRINGS.manualTitle];

  for (const section of manual.sections) {
    const label = STRINGS.manualSectionLabels[section.key] ?? section.key;
    blocks.push(label.toUpperCase());

    if (section.entries.length > 0) {
      const lines: string[] = [STRINGS.manualLaneDeclared];
      for (const entry of section.entries) {
        lines.push(`  ${entry.question}`);
        lines.push(`  "${entry.answer}" (${formatDate(entry.localDate)})`);
        for (const older of entry.earlier) {
          lines.push(`  "${older.answer}" (${formatDate(older.localDate)})`);
        }
      }
      blocks.push(lines.join('\n'));
    }

    if (section.observations.length > 0) {
      const lines: string[] = [STRINGS.manualLaneObserved];
      for (const observation of section.observations) {
        lines.push(`  ${observation.text}`);
        if (observation.evidence) lines.push(`  ${observation.evidence}`);
      }
      blocks.push(lines.join('\n'));
    }
  }

  blocks.push(STRINGS.manualExportFooter);
  return blocks.join('\n\n');
}

export async function getMyManual(userId: string): Promise<Manual> {
  const [rowsResult, patterns] = await Promise.all([
    supabase
      .from('reflections')
      .select(
        'local_date, question_answer, question_prompt_snapshot, questions!inner(code, prompt, manual_section, answer_lane, why_we_ask)'
      )
      .eq('user_id', userId)
      .eq('question_skipped', false)
      .not('question_answer', 'is', null)
      .eq('questions.answer_lane', 'declaration')
      .not('questions.manual_section', 'is', null)
      .order('local_date', { ascending: false })
      .returns<ManualRow[]>(),
    // The observed lane is additive: if it fails, the manual still shows
    // what the person said. It must never fail CLOSED into a wrong claim,
    // and an absent observation block claims nothing (FF1's rule).
    getMyBlueprint().catch(() => [] as BlueprintPattern[]),
  ]);

  if (rowsResult.error) throw rowsResult.error;
  return assembleManual(rowsResult.data ?? [], patterns);
}
