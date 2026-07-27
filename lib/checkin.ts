import { getMyRallyCount } from './journey';
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

/** SK1 job 3 — where a "check in" tap actually goes. Four destinations,
 * and the ORDER between them is the whole point, so it lives here as one
 * pure decision rather than as an if-chain repeated on Today and on the
 * timer screen:
 *
 *  - `activity` (the timer / resource screen) wins over everything for a
 *    circle that has one, opted out or not: the sit IS the practice, and
 *    reflections are a separate thing entirely. The timer then routes on
 *    with this same function.
 *  - `one-tap` is SK1's flow: no reflection screen at all, the day is
 *    recorded and the person lands straight on the success beat.
 *  - `intro` (the one-shot "this builds your private map" consent) is
 *    SKIPPED when opted out — it exists to explain reflections, so
 *    showing it to someone who has turned them off would be the exact
 *    pitch the no-nag law forbids.
 *  - `reflection` is the normal check-in screen, unchanged.
 */
export type CheckinRoute = 'activity' | 'intro' | 'one-tap' | 'reflection';

export function resolveCheckinRoute(params: {
  hasSeenCheckinConsent: boolean;
  goesToActivityScreen: boolean;
  reflectionsOptOut: boolean;
}): CheckinRoute {
  if (params.goesToActivityScreen) return 'activity';
  if (params.reflectionsOptOut) return 'one-tap';
  if (!params.hasSeenCheckinConsent) return 'intro';
  return 'reflection';
}

/** SK1 job 3 — a day recorded with no reflection attached, and whether
 * THIS save is the one that earned the day (which is what decides the
 * glow beat downstream). Deliberately the same two calls check-in makes
 * around saveReflection, minus the reflection, so there is ONE way a
 * completion gets written no matter which flow the person is in. */
export async function recordCheckinWithoutReflection(params: {
  userId: string;
  circleId: string;
  localDate: string;
}): Promise<{ earnedToday: boolean }> {
  // Checked BEFORE saving, exactly as handleSave does — after the upsert
  // it would always read true.
  const alreadyEarnedToday = await hasAnyCompletionToday({
    userId: params.userId,
    localDate: params.localDate,
  });
  await saveCompletion(params);
  return { earnedToday: !alreadyEarnedToday };
}

/** The user's reflection for a given local day, if they've already done
 * one today — regardless of which circle triggered it, since reflection
 * is one-per-person-per-day, not one-per-circle. */
/** SC3 — the Wrapped line picker's source: the caller's OWN reflection
 * lines (line1/line2), newest first, within a local-date window (the
 * journey being celebrated). RLS on reflections is owner-only, so this
 * can never return anyone else's words — and per the share-cards spec
 * (§4.5), this picker is the ONLY place reflection text can reach a
 * card, always by explicit selection. */
export async function listMyReflectionLines(
  fromLocalDate: string,
  toLocalDate: string
): Promise<{ date: string; text: string }[]> {
  const { data, error } = await supabase
    .from('reflections')
    .select('local_date, line1, line2')
    .gte('local_date', fromLocalDate)
    .lte('local_date', toLocalDate)
    .order('local_date', { ascending: false });
  if (error) throw error;
  const lines: { date: string; text: string }[] = [];
  for (const row of (data ?? []) as { local_date: string; line1: string | null; line2: string | null }[]) {
    for (const text of [row.line1, row.line2]) {
      const trimmed = text?.trim();
      if (trimmed) lines.push({ date: row.local_date, text: trimmed });
    }
  }
  return lines;
}

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

/** SK1 job 4 — has this person ever checked in themselves, in any circle?
 * The CURIOSITY LAW's truth test for the journal's dormant line: "your
 * check-ins are stacking up" is a claim about them, and the app may not
 * make it about someone who hasn't started yet. Existence only, never a
 * displayed number, so it stays a single indexed row read. */
export async function hasAnyOwnCompletionEver(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('completions')
    .select('id')
    .eq('user_id', userId)
    .eq('kind', 'self')
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
  // PA1 — this is the RALLY COUNT, and always was: same circle, same
  // user, kind='self' only. It now delegates so there is exactly ONE
  // definition of that number in the app; two identical queries in two
  // files is how the covers trap gets re-introduced on one of them.
  return getMyRallyCount(params.circleId, params.userId);
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
  // GQ1: the goals-set key for the day's second-slot question — written
  // whether or not line2 was answered (an empty answer next to a
  // recorded key IS the skip log; skips are signal).
  line2PromptKey: string | null;
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
      line2_prompt_key: params.line2PromptKey,
      question_id: params.questionId,
      question_answer: params.questionAnswer,
      question_skipped: params.questionSkipped,
    },
    { onConflict: 'user_id,local_date' }
  );

  if (error) throw error;
}
