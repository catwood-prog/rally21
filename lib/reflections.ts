import { daysBetween, getTrailingLocalDates } from './signal';
import { supabase } from './supabase';

// Reflections are per-person-per-day, not per-circle — there's no
// circleId here by design (see Rally21_MultiCircle_Spec).
export type Reflection = {
  id: string;
  localDate: string;
  mood: number | null;
  line1: string | null;
  line2: string | null;
  questionPrompt: string | null;
  questionAnswer: string | null;
  createdAt: string;
};

type ReflectionRow = {
  id: string;
  local_date: string;
  mood: number | null;
  line1: string | null;
  line2: string | null;
  question_answer: string | null;
  created_at: string;
  questions: { prompt: string } | null;
};

export async function getMyReflections(userId: string): Promise<Reflection[]> {
  const { data, error } = await supabase
    .from('reflections')
    .select('id, local_date, mood, line1, line2, question_answer, created_at, questions(prompt)')
    .eq('user_id', userId)
    .order('local_date', { ascending: false })
    .returns<ReflectionRow[]>();

  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id,
    localDate: r.local_date,
    mood: r.mood,
    line1: r.line1,
    line2: r.line2,
    questionPrompt: r.questions?.prompt ?? null,
    questionAnswer: r.question_answer,
    createdAt: r.created_at,
  }));
}

// ── weekly look-back ─────────────────────────────────────────────────────

export type WeeklyLookback = {
  daysShowedUp: number;
  totalDays: number;
  dailyMoods: (number | null)[]; // oldest to newest
  dates: string[];
  standout: { text: string; label: 'grateful' | 'learned'; date: string } | null;
};

/**
 * The window is min(7, days since the circle started) — same reasoning as
 * the signal: a day-1 circle reads "1 of 1", not "1 of 7" with six empty
 * bars for days before it existed.
 */
export function computeWeeklyLookback(
  reflections: Reflection[],
  today: string,
  circleStartDate: string
): WeeklyLookback {
  const dayNumber = Math.max(1, daysBetween(circleStartDate, today) + 1);
  const windowSize = Math.min(7, dayNumber);
  const dates = getTrailingLocalDates(today, windowSize);
  const byDate = new Map<string, Reflection>();
  for (const r of reflections) {
    if (dates.includes(r.localDate) && !byDate.has(r.localDate)) {
      byDate.set(r.localDate, r);
    }
  }

  const dailyMoods = dates.map((d) => byDate.get(d)?.mood ?? null);

  let bestMood = -1;
  for (const r of byDate.values()) {
    if (r.mood !== null && r.mood > bestMood) bestMood = r.mood;
  }

  let standout: WeeklyLookback['standout'] = null;
  if (bestMood >= 0) {
    let bestLen = -1;
    for (const r of byDate.values()) {
      if (r.mood !== bestMood) continue;
      const candidates: { text: string; label: 'grateful' | 'learned' }[] = [];
      if (r.line1) candidates.push({ text: r.line1, label: 'grateful' });
      if (r.line2) candidates.push({ text: r.line2, label: 'learned' });
      for (const cand of candidates) {
        if (cand.text.length > bestLen) {
          bestLen = cand.text.length;
          standout = { text: cand.text, label: cand.label, date: r.localDate };
        }
      }
    }
  }

  return { daysShowedUp: byDate.size, totalDays: dates.length, dailyMoods, dates, standout };
}

// ── day-14 reflected observation ────────────────────────────────────────

export type ObservationDirection =
  | 'before_noon_higher'
  | 'after_noon_higher'
  | 'weekday_higher'
  | 'weekend_higher';

export type DayObservation =
  | { available: false; dataPoints: number }
  | {
      available: true;
      type: 'time_of_day' | 'weekday';
      direction: ObservationDirection;
      agreementCount: number;
      totalCount: number;
    };

function evaluateSplit(
  points: { mood: number; inGroupA: boolean }[]
): { aIsHigher: boolean; agreementCount: number; totalCount: number; agreementRate: number } | null {
  if (points.length < 10) return null;

  const groupA = points.filter((p) => p.inGroupA).map((p) => p.mood);
  const groupB = points.filter((p) => !p.inGroupA).map((p) => p.mood);
  if (groupA.length === 0 || groupB.length === 0) return null;

  const sortedMoods = points.map((p) => p.mood).sort((a, b) => a - b);
  const mid = Math.floor(sortedMoods.length / 2);
  const median =
    sortedMoods.length % 2 === 0
      ? (sortedMoods[mid - 1] + sortedMoods[mid]) / 2
      : sortedMoods[mid];

  const avgA = groupA.reduce((s, m) => s + m, 0) / groupA.length;
  const avgB = groupB.reduce((s, m) => s + m, 0) / groupB.length;
  const aIsHigher = avgA >= avgB;

  let agreementCount = 0;
  for (const p of points) {
    const shouldBeHigh = p.inGroupA === aIsHigher;
    const isHigh = p.mood >= median;
    if (shouldBeHigh === isHigh) agreementCount++;
  }

  return {
    aIsHigher,
    agreementCount,
    totalCount: points.length,
    agreementRate: agreementCount / points.length,
  };
}

/**
 * Deterministic pattern over the last 14 check-ins with mood recorded:
 * mood vs check-in time (before/after noon) and mood vs weekday
 * (weekday/weekend). Only surfaces a pattern that holds on >= 60% of days
 * with >= 10 data points — otherwise the caller shows the "grows as you
 * go" state instead of a shaky claim.
 */
export function computeDayObservation(reflections: Reflection[]): DayObservation {
  const withMood = reflections
    .filter((r) => r.mood !== null)
    .slice(0, 14)
    .map((r) => ({
      mood: r.mood as number,
      hour: new Date(r.createdAt).getHours(),
      weekday: new Date(`${r.localDate}T00:00:00`).getDay(), // 0=Sun..6=Sat
    }));

  const timeResult = evaluateSplit(withMood.map((c) => ({ mood: c.mood, inGroupA: c.hour < 12 })));
  const weekdayResult = evaluateSplit(
    withMood.map((c) => ({ mood: c.mood, inGroupA: c.weekday >= 1 && c.weekday <= 5 }))
  );

  const candidates: {
    type: 'time_of_day' | 'weekday';
    result: NonNullable<typeof timeResult>;
  }[] = [];
  if (timeResult && timeResult.agreementRate >= 0.6) candidates.push({ type: 'time_of_day', result: timeResult });
  if (weekdayResult && weekdayResult.agreementRate >= 0.6)
    candidates.push({ type: 'weekday', result: weekdayResult });

  if (candidates.length === 0) {
    return { available: false, dataPoints: withMood.length };
  }

  candidates.sort((a, b) => b.result.agreementRate - a.result.agreementRate);
  const best = candidates[0];

  const direction: ObservationDirection =
    best.type === 'time_of_day'
      ? best.result.aIsHigher
        ? 'before_noon_higher'
        : 'after_noon_higher'
      : best.result.aIsHigher
        ? 'weekday_higher'
        : 'weekend_higher';

  return {
    available: true,
    type: best.type,
    direction,
    agreementCount: best.result.agreementCount,
    totalCount: best.result.totalCount,
  };
}

export async function getMyObservationResponse(
  userId: string,
  type: 'time_of_day' | 'weekday',
  direction: ObservationDirection
): Promise<'confirmed' | 'rejected' | null> {
  const { data, error } = await supabase
    .from('observation_responses')
    .select('response')
    .eq('user_id', userId)
    .eq('pattern_type', type)
    .eq('direction', direction)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data?.response as 'confirmed' | 'rejected' | undefined) ?? null;
}

export async function saveObservationResponse(params: {
  userId: string;
  type: 'time_of_day' | 'weekday';
  direction: ObservationDirection;
  agreementCount: number;
  totalCount: number;
  response: 'confirmed' | 'rejected';
}): Promise<void> {
  const { error } = await supabase.from('observation_responses').insert({
    user_id: params.userId,
    pattern_type: params.type,
    direction: params.direction,
    agreement_count: params.agreementCount,
    total_count: params.totalCount,
    response: params.response,
  });

  if (error) throw error;
}
