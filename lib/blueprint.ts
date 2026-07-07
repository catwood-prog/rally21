import { supabase } from './supabase';

// Blueprint v0 (Rally21-Blueprint-Notes.md) — deterministic pattern
// cards computed server-side from the caller's own reflections and
// completions, no LLM anywhere. The client only shapes copy from the
// RPC's structured fields; it never computes evidence itself.

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

export type BlueprintPattern = {
  patternKey: string;
  patternType: 'weekday_mood' | 'time_of_day_mood' | 'consistency' | 'synthesis_pattern' | 'synthesis_want';
  weekday: number | null;
  direction: 'low' | 'high' | 'before_noon_higher' | 'after_noon_higher' | null;
  cutoffHour: number | null;
  agreementCount: number;
  totalCount: number;
  evidenceRate: number;
  statement: string | null;
};

type BlueprintPatternRow = {
  pattern_key: string;
  pattern_type: BlueprintPattern['patternType'];
  weekday: number | null;
  direction: string | null;
  cutoff_hour: number | null;
  agreement_count: number;
  total_count: number;
  evidence_rate: number;
  statement: string | null;
};

export async function getMyBlueprint(): Promise<BlueprintPattern[]> {
  const { data, error } = await supabase.rpc('get_my_blueprint');
  if (error) throw error;
  return ((data ?? []) as BlueprintPatternRow[]).map((row) => ({
    patternKey: row.pattern_key,
    patternType: row.pattern_type,
    weekday: row.weekday,
    direction: row.direction as BlueprintPattern['direction'],
    cutoffHour: row.cutoff_hour,
    agreementCount: row.agreement_count,
    totalCount: row.total_count,
    evidenceRate: row.evidence_rate,
    statement: row.statement,
  }));
}

/** Bold statement + plain evidence sentence. Synthesis-sourced patterns
 * (B2) carry their own pre-written `statement` and skip the template
 * entirely; B1's deterministic patterns still compose from structured
 * fields — never free text from the server for those. */
export function describeBlueprintPattern(p: BlueprintPattern): { headline: string; accent: string; evidence: string } {
  if (p.patternType === 'synthesis_pattern' || p.patternType === 'synthesis_want') {
    return { headline: p.statement ?? '', accent: '', evidence: '' };
  }
  if (p.patternType === 'weekday_mood' && p.weekday !== null) {
    const isLow = p.direction === 'low';
    return {
      headline: `Your mood runs ${isLow ? 'lowest' : 'highest'} on`,
      accent: WEEKDAY_NAMES[p.weekday],
      evidence: `mood ${isLow ? 'low' : 'high'} on ${p.agreementCount} of your last ${p.totalCount} ${WEEKDAY_PLURAL[p.weekday]}.`,
    };
  }
  if (p.patternType === 'time_of_day_mood') {
    const beforeNoon = p.direction === 'before_noon_higher';
    return {
      headline: 'Your mood runs highest on days you check in',
      accent: beforeNoon ? 'before noon' : 'after noon',
      evidence: `Based on ${p.agreementCount} of your last ${p.totalCount} check-ins.`,
    };
  }
  const hour = p.cutoffHour ?? 9;
  const label = hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`;
  return {
    headline: 'Most of your check-ins land',
    accent: `before ${label}`,
    evidence: `${p.agreementCount} of your last ${p.totalCount} check-ins.`,
  };
}

export type BlueprintResponse = {
  patternKey: string;
  response: 'confirmed' | 'not_quite';
  note: string | null;
};

export async function getMyBlueprintResponses(userId: string): Promise<BlueprintResponse[]> {
  const { data, error } = await supabase
    .from('blueprint_responses')
    .select('pattern_key, response, note')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    patternKey: r.pattern_key,
    response: r.response as 'confirmed' | 'not_quite',
    note: r.note,
  }));
}

export async function respondToBlueprintPattern(params: {
  userId: string;
  patternKey: string;
  response: 'confirmed' | 'not_quite';
  note?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('blueprint_responses').insert({
    user_id: params.userId,
    pattern_key: params.patternKey,
    response: params.response,
    note: params.note ?? null,
  });
  if (error) throw error;
}

export async function markBlueprintPatternSurfaced(patternKey: string): Promise<void> {
  const { error } = await supabase.rpc('mark_blueprint_pattern_surfaced', { p_pattern_key: patternKey });
  if (error) throw error;
}

// Blueprint v2 (B3) — traits, the evolution view, and the wants act flow
// (Rally21-Blueprint-Notes.md). Traits/evolution/want all read the
// caller's latest blueprint_versions row DIRECTLY (owner-only RLS) rather
// than through get_my_blueprint() — that RPC's job is "what's still
// active" (top 3 by evidence, excludes not_quite entirely), not "what's
// ever happened." Confirmed/retired synthesis items and traits live only
// in the version document, so this is the one read path that can't lose
// them to the RPC's own cutoff.

export type BlueprintTrait = {
  key: string;
  label: string;
  confidence: number;
  evidenceRefs: string[];
};

export type BlueprintConfidenceWord = 'hunch' | 'fairly sure' | 'solid';

/** Ask-Rally spec §3: traits render as confidence WORDS, never numbers.
 * Below 0.4 a trait doesn't surface at all (the same floor the spec uses
 * for ask-rally's own blueprint_block) — the word bands above that are
 * ours, evenly split across the remaining range. */
export function describeConfidence(confidence: number): BlueprintConfidenceWord | null {
  if (confidence < 0.4) return null;
  if (confidence < 0.6) return 'hunch';
  if (confidence < 0.8) return 'fairly sure';
  return 'solid';
}

export type BlueprintEvolutionEntry = {
  key: string;
  statement: string;
  status: 'confirmed' | 'rejected';
};

export type BlueprintWantDetail = {
  key: string;
  statement: string;
  status: 'surfaced' | 'confirmed' | 'rejected';
};

type RawTrait = { key: string; label: string; confidence: number; evidence_refs?: string[] };
type RawEntry = { key: string; statement: string; status: string };
type RawBlueprintContent = { traits?: RawTrait[]; patterns?: RawEntry[]; wants?: RawEntry[] };

export type BlueprintDocument = {
  traits: BlueprintTrait[];
  evolution: BlueprintEvolutionEntry[];
  want: BlueprintWantDetail | null;
};

export async function getMyBlueprintDocument(): Promise<BlueprintDocument> {
  const { data, error } = await supabase
    .from('blueprint_versions')
    .select('content')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ content: RawBlueprintContent }>();
  if (error) throw error;

  const content = data?.content ?? {};

  const traits: BlueprintTrait[] = (content.traits ?? []).map((t) => ({
    key: t.key,
    label: t.label,
    confidence: t.confidence,
    evidenceRefs: t.evidence_refs ?? [],
  }));

  const evolution: BlueprintEvolutionEntry[] = (content.patterns ?? [])
    .filter((p): p is RawEntry & { status: 'confirmed' | 'rejected' } => p.status === 'confirmed' || p.status === 'rejected')
    .map((p) => ({ key: p.key, statement: p.statement, status: p.status }));

  const wantRow = (content.wants ?? [])[0];
  const want: BlueprintWantDetail | null = wantRow
    ? { key: wantRow.key, statement: wantRow.statement, status: wantRow.status as BlueprintWantDetail['status'] }
    : null;

  return { traits, evolution, want };
}

/** A rough, honest starting point for the practice-name field when a
 * confirmed want becomes a circle — never a clever rewrite, just strips
 * the want statement's own "you keep reaching for" framing (the phrasing
 * the synthesis prompt is told to use) since that doesn't read as a
 * practice name on its own. Always editable before saving. */
export function deriveWantPracticeName(statement: string): string {
  const stripped = statement.replace(/^you keep reaching for\s+/i, '').trim().replace(/\.$/, '');
  if (!stripped) return statement;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** Same "you keep reaching for" strip as deriveWantPracticeName, but
 * lowercased for mid-sentence splicing — used by R1's archive banner
 * ("21 days toward {phrase}"). */
export function deriveWantPhrase(statement: string): string {
  const stripped = statement.replace(/^you keep reaching for\s+/i, '').trim().replace(/\.$/, '');
  if (!stripped) return statement;
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}

export type WantActivation = {
  circleId: string;
  wantStatement: string;
};

export async function getWantActivation(wantKey: string): Promise<WantActivation | null> {
  const { data, error } = await supabase
    .from('want_activations')
    .select('circle_id, want_statement')
    .eq('want_key', wantKey)
    .maybeSingle<{ circle_id: string; want_statement: string }>();
  if (error) throw error;
  if (!data) return null;
  return { circleId: data.circle_id, wantStatement: data.want_statement };
}

export async function activateWant(params: {
  userId: string;
  wantKey: string;
  wantStatement: string;
  circleId: string;
}): Promise<void> {
  const { error } = await supabase.from('want_activations').insert({
    user_id: params.userId,
    want_key: params.wantKey,
    want_statement: params.wantStatement,
    circle_id: params.circleId,
  });
  if (error) throw error;
}

/** R1's day-21 gate copy (B3 step 3): when a completing circle was born
 * from a want, the archive banner names it — nothing more than that one
 * review beat. */
export async function getWantActivationForCircle(circleId: string): Promise<{ wantStatement: string } | null> {
  const { data, error } = await supabase
    .from('want_activations')
    .select('want_statement')
    .eq('circle_id', circleId)
    .maybeSingle<{ want_statement: string }>();
  if (error) throw error;
  return data ? { wantStatement: data.want_statement } : null;
}
