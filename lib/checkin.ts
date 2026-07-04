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
    .single<DailyQuestion>();

  if (error) throw error;
  return data ?? null;
}

/** "I did this circle's practice today." Idempotent — completing an
 * already-completed circle/day is a no-op, never a duplicate. */
export async function saveCompletion(params: {
  userId: string;
  circleId: string;
  localDate: string;
}): Promise<void> {
  const { error } = await supabase.from('completions').upsert(
    { user_id: params.userId, circle_id: params.circleId, local_date: params.localDate },
    { onConflict: 'circle_id,user_id,local_date', ignoreDuplicates: true }
  );

  if (error) throw error;
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
