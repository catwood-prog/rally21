import { supabase } from './supabase';

// Blueprint v0 (Rally21-Blueprint-Notes.md) — deterministic pattern
// cards computed server-side from the caller's own reflections and
// completions, no LLM anywhere. The client only shapes copy from the
// RPC's structured fields; it never computes evidence itself.

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

export type BlueprintPattern = {
  patternKey: string;
  patternType: 'weekday_mood' | 'time_of_day_mood' | 'consistency';
  weekday: number | null;
  direction: 'low' | 'high' | 'before_noon_higher' | 'after_noon_higher' | null;
  cutoffHour: number | null;
  agreementCount: number;
  totalCount: number;
  evidenceRate: number;
};

type BlueprintPatternRow = {
  pattern_key: string;
  pattern_type: 'weekday_mood' | 'time_of_day_mood' | 'consistency';
  weekday: number | null;
  direction: string | null;
  cutoff_hour: number | null;
  agreement_count: number;
  total_count: number;
  evidence_rate: number;
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
  }));
}

/** Bold statement + plain evidence sentence, composed from the RPC's
 * structured fields — never free text from the server. */
export function describeBlueprintPattern(p: BlueprintPattern): { headline: string; accent: string; evidence: string } {
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
