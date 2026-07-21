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

// YD1 (21 July) — the "delete a single check-in" pickers/deleter that
// lived here are gone with their UI section (Cat's 20 July ruling). The
// owner-scoped DELETE RLS policy on completions stays — the ruling was
// about the surface, not the schema.

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
