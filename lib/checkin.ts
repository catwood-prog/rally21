import { supabase } from './supabase';

export type DailyQuestion = {
  id: string;
  dimension: string;
  prompt: string;
  format: 'scale' | 'chips' | 'short_text' | 'binary';
  depth: string;
  options: string[] | null;
};

export type Checkin = {
  mood: number | null;
  line: string | null;
  line2: string | null;
  questionId: string | null;
  questionAnswer: string | null;
  questionSkipped: boolean;
};

export async function getTodayCheckin(
  circleId: string,
  localDate: string
): Promise<Checkin | null> {
  const { data, error } = await supabase
    .from('checkins')
    .select('mood, line, line2, question_id, question_answer, question_skipped')
    .eq('circle_id', circleId)
    .eq('local_date', localDate)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    mood: data.mood,
    line: data.line,
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

export async function saveCheckin(params: {
  userId: string;
  circleId: string;
  localDate: string;
  mood: number;
  line: string;
  line2: string | null;
  questionId: string | null;
  questionAnswer: string | null;
  questionSkipped: boolean;
}): Promise<void> {
  const { error } = await supabase.from('checkins').upsert(
    {
      user_id: params.userId,
      circle_id: params.circleId,
      local_date: params.localDate,
      mood: params.mood,
      line: params.line,
      line2: params.line2,
      question_id: params.questionId,
      question_answer: params.questionAnswer,
      question_skipped: params.questionSkipped,
    },
    { onConflict: 'user_id,circle_id,local_date' }
  );

  if (error) throw error;
}
