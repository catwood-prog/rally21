import { captureError } from './sentry';
import { supabase } from './supabase';

export type DailyQuestion = {
  id: string;
  dimension: string;
  prompt: string;
  format: 'scale' | 'chips' | 'short_text' | 'binary';
  depth: string;
  options: string[] | null;
};

export type TodayReflection = {
  mood: number | null;
  line1: string | null;
  line2: string | null;
  questionId: string | null;
  questionAnswer: string | null;
  questionSkipped: boolean;
};

/** A reflections row only counts as a real, written reflection once it
 * carries mood or a grateful-for line. Q1's get_daily_question() pins
 * the day's question by inserting a bare stub row (question_id +
 * snapshot only) the first time it's called for a day — including from
 * Today's passive reflection teaser, before the user has opened
 * check-in at all. Anywhere "has today been reflected on" gates a flow
 * must use this, not a bare existence check, or a pin stub reads as a
 * completed day. */
export function isReflectionSubstantive(r: { mood: number | null; line1: string | null }): boolean {
  return r.mood !== null || r.line1 !== null;
}

/** The user's reflection for a given local day, if they've already done
 * one today — regardless of which circle triggered it, since reflection
 * is one-per-person-per-day, not one-per-circle. */
export async function getTodayReflection(localDate: string): Promise<TodayReflection | null> {
  const { data, error } = await supabase
    .from('reflections')
    .select('mood, line1, line2, question_id, question_answer, question_skipped')
    .eq('local_date', localDate)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    mood: data.mood,
    line1: data.line1,
    line2: data.line2,
    questionId: data.question_id,
    questionAnswer: data.question_answer,
    questionSkipped: data.question_skipped,
  };
}

export async function getQuestionById(questionId: string): Promise<DailyQuestion | null> {
  const { data, error } = await supabase
    .from('questions')
    .select('id, dimension, prompt, format, depth, options')
    .eq('id', questionId)
    .maybeSingle();

  if (error) throw error;
  return data as DailyQuestion | null;
}

export async function getDailyQuestion(localDate: string): Promise<DailyQuestion | null> {
  const { data, error } = await supabase
    .rpc('get_daily_question', { p_local_date: localDate })
    .maybeSingle<DailyQuestion>();

  if (error) {
    captureError(error, { rpc: 'get_daily_question' });
    throw error;
  }
  return data ?? null;
}

/** "I did this circle's practice today." Idempotent — completing an
 * already-completed circle/day is a no-op, never a duplicate. */
export async function saveCompletion(params: {
  userId: string;
  circleId: string;
  localDate: string;
}): Promise<void> {
  // RS2: "simply checking in" is one of the two ways to end an away
  // pause — a cheap no-op if the caller isn't currently away, so every
  // check-in can call it unconditionally rather than checking away
  // status first. Never blocks the actual check-in on failure.
  try {
    await supabase.rpc('return_from_away');
  } catch (e) {
    captureError(e, { rpc: 'return_from_away' });
  }

  const { error } = await supabase.from('completions').upsert(
    { user_id: params.userId, circle_id: params.circleId, local_date: params.localDate },
    { onConflict: 'circle_id,user_id,local_date', ignoreDuplicates: true }
  );

  if (error) throw error;
}

/** A direct, targeted read of whether THIS circle's completion for
 * today already exists — deliberately not derived from the full
 * per-circle presence list (a real cold-load race was traced to that
 * derivation), so a fresh /checkin page load can't momentarily read
 * "not completed yet" for a circle whose completion was just saved. */
export async function hasCompletedToday(params: {
  userId: string;
  circleId: string;
  localDate: string;
}): Promise<boolean> {
  const { data, error } = await supabase
    .from('completions')
    .select('user_id')
    .eq('user_id', params.userId)
    .eq('circle_id', params.circleId)
    .eq('local_date', params.localDate)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

/** G5 (Rally21-Glow-Spec.md §1): whether the user has ANY own completion
 * for this local date, in any circle — unlike hasCompletedToday, not
 * scoped to one circle. Checked BEFORE calling saveCompletion so the
 * caller can tell whether the save about to happen is the one that
 * EARNS the day (glow increments) versus a second-circle completion or
 * an edit of an already-completed circle, both of which find this
 * already true. */
export async function hasAnyCompletionToday(params: { userId: string; localDate: string }): Promise<boolean> {
  const { data, error } = await supabase
    .from('completions')
    .select('id')
    .eq('user_id', params.userId)
    .eq('kind', 'self')
    .eq('local_date', params.localDate)
    .limit(1);

  if (error) throw error;
  return (data ?? []).length > 0;
}

/** SC2 — how many days the user has shown up for THIS circle themselves
 * (kind = 'self': covered days are a friend's gift, deliberately not
 * counted in a "you've kept a promise to yourself" claim — same honesty
 * rule as getMyCompletions' weekly count). Feeds the journey card's
 * count slots; the card templates must stay count-true, never rounded. */
export async function countMyCircleCompletions(params: {
  userId: string;
  circleId: string;
}): Promise<number> {
  const { count, error } = await supabase
    .from('completions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', params.userId)
    .eq('circle_id', params.circleId)
    .eq('kind', 'self');

  if (error) throw error;
  return count ?? 0;
}

/** The day's mood/lines/question — one per person per local day, shared
 * across however many circles they're in. Re-saving the same day edits
 * this same row rather than creating another. */
export async function saveReflection(params: {
  userId: string;
  localDate: string;
  mood: number;
  line1: string;
  line2: string | null;
  questionId: string | null;
  questionAnswer: string | null;
  questionSkipped: boolean;
}): Promise<void> {
  const { error } = await supabase.from('reflections').upsert(
    {
      user_id: params.userId,
      local_date: params.localDate,
      mood: params.mood,
      line1: params.line1,
      line2: params.line2,
      question_id: params.questionId,
      question_answer: params.questionAnswer,
      question_skipped: params.questionSkipped,
    },
    { onConflict: 'user_id,local_date' }
  );

  if (error) throw error;
}
