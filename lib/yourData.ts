import { isReflectionSubstantive } from './checkin';
import { getMyNotificationPrefs, NotificationPrefs } from './notifications';
import { supabase } from './supabase';

// DC1 (7 July) — "your data & privacy" screen (Rally21-MVP-Screens mockup
// #23): the privacy-promise screen makes three promises ("see, correct, or
// delete anytime"); this module is what makes them real. Every read here
// goes through existing owner-scoped RLS — no new privileged RPCs, per the
// prompt's own instruction.

export type DataSummary = {
  name: string | null;
  joinedDate: string;
  circleCount: number;
  checkinCount: number;
  reflectionCount: number;
  hasPrivateMap: boolean;
  conversationMessageCount: number;
  notificationPrefs: NotificationPrefs | null;
};

/** A plain-language "what we keep" summary, grouped warmly per the
 * mockup — real counts from owner-scoped reads, nothing clinical. */
export async function getDataSummary(userId: string): Promise<DataSummary> {
  const [userResult, membershipsResult, completionsResult, reflectionsResult, blueprintResult, messagesResult, prefs] =
    await Promise.all([
      supabase.from('users').select('name, created_at').eq('id', userId).maybeSingle<{ name: string | null; created_at: string }>(),
      supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase
        .from('completions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('kind', 'self'),
      supabase.from('reflections').select('mood, line1').eq('user_id', userId),
      supabase.from('blueprint_versions').select('id').eq('user_id', userId).limit(1).maybeSingle<{ id: string }>(),
      supabase.from('ask_messages').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      getMyNotificationPrefs(userId),
    ]);

  const reflectionCount = (reflectionsResult.data ?? []).filter((r) =>
    isReflectionSubstantive({ mood: r.mood, line1: r.line1 })
  ).length;

  return {
    name: userResult.data?.name ?? null,
    joinedDate: userResult.data?.created_at ?? new Date().toISOString(),
    circleCount: membershipsResult.count ?? 0,
    checkinCount: completionsResult.count ?? 0,
    reflectionCount,
    hasPrivateMap: !!blueprintResult.data,
    conversationMessageCount: messagesResult.count ?? 0,
    notificationPrefs: prefs,
  };
}

export type DeletableCompletion = {
  id: string;
  circleId: string;
  circleName: string;
  localDate: string;
  kind: 'self' | 'covered';
};

const RECENT_COMPLETIONS_LOOKBACK = 30;

/** The picker for "delete a single check-in" — the caller's own
 * completions rows only (RLS enforces this regardless), most recent
 * first, joined with the circle's name for a readable list. */
export async function getRecentCompletionsForDeletion(userId: string): Promise<DeletableCompletion[]> {
  const { data, error } = await supabase
    .from('completions')
    .select('id, circle_id, local_date, kind, circles(name)')
    .eq('user_id', userId)
    .order('local_date', { ascending: false })
    .limit(RECENT_COMPLETIONS_LOOKBACK)
    .returns<{ id: string; circle_id: string; local_date: string; kind: string; circles: { name: string } | null }[]>();

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    circleId: row.circle_id,
    circleName: row.circles?.name ?? 'a circle',
    localDate: row.local_date,
    kind: row.kind === 'covered' ? 'covered' : 'self',
  }));
}

/** A real hard delete of exactly one completions row — RLS scopes this to
 * the caller's own rows regardless of what id is passed. Glow/signal
 * recompute live from what's left; nothing else references this row. */
export async function deleteMyCompletion(completionId: string): Promise<void> {
  const { error } = await supabase.from('completions').delete().eq('id', completionId);
  if (error) throw error;
}

/** Assembles the caller's own data into a plain object for the "export it
 * all" download — owner-scoped reads only, nothing about other people
 * beyond the circles' own names. */
export async function exportMyData(userId: string): Promise<Record<string, unknown>> {
  const [userResult, membershipsResult, completionsResult, reflectionsResult, blueprintResult, messagesResult] =
    await Promise.all([
      supabase.from('users').select('name, timezone, created_at').eq('id', userId).maybeSingle(),
      supabase
        .from('memberships')
        .select('joined_at, circles(name, start_date, duration_days, completed_at)')
        .eq('user_id', userId),
      supabase
        .from('completions')
        .select('local_date, kind, circles(name)')
        .eq('user_id', userId)
        .order('local_date', { ascending: true }),
      supabase
        .from('reflections')
        .select('local_date, mood, line1, line2, question_answer')
        .eq('user_id', userId)
        .order('local_date', { ascending: true }),
      supabase
        .from('blueprint_versions')
        .select('version, content, generated_at')
        .eq('user_id', userId)
        .order('version', { ascending: true }),
      supabase
        .from('ask_messages')
        .select('role, content, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    profile: userResult.data ?? null,
    circles: (membershipsResult.data ?? []).map((m: any) => ({
      joinedAt: m.joined_at,
      name: m.circles?.name ?? null,
      startDate: m.circles?.start_date ?? null,
      durationDays: m.circles?.duration_days ?? null,
      completedAt: m.circles?.completed_at ?? null,
    })),
    checkIns: (completionsResult.data ?? []).map((c: any) => ({
      localDate: c.local_date,
      kind: c.kind,
      circleName: c.circles?.name ?? null,
    })),
    reflections: reflectionsResult.data ?? [],
    privateMapVersions: blueprintResult.data ?? [],
    askRallyMessages: messagesResult.data ?? [],
  };
}
