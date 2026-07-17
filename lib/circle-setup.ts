import { CIRCLE_MEMBER_CAP } from './caps';
import { PracticeDomain, PracticeTypeKey } from './practiceTaxonomy';
import { captureError } from './sentry';
import { supabase } from './supabase';

/** PT1: the category IS the taxonomy domain — six shelves, defined in
 * lib/practiceTaxonomy.ts (the spec's source of truth). */
export type PracticeCategory = PracticeDomain;

export type Practice = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: PracticeCategory;
  /** PT1: the fixed type key under the domain — THE analytics unit;
   * CHECK-constrained in the database to the spec's 29 permanent keys. */
  practiceType: PracticeTypeKey;
  durationMinutes: number | null;
  createdBy: string | null;
  isArchived: boolean;
  /** Seeded practices are always shared; a custom practice becomes
   * shared only once a public circle uses it (see CLAUDE.md's
   * practice-privacy rule) — never set directly by the client. */
  isShared: boolean;
};

const PRACTICE_SELECT =
  'id, key, name, description, category, practice_type, duration_minutes, created_by, is_archived, is_shared';

function mapPractice(row: {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: PracticeCategory;
  practice_type: PracticeTypeKey;
  duration_minutes: number | null;
  created_by: string | null;
  is_archived: boolean;
  is_shared: boolean;
}): Practice {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    practiceType: row.practice_type,
    durationMinutes: row.duration_minutes,
    createdBy: row.created_by,
    isArchived: row.is_archived,
    isShared: row.is_shared,
  };
}

/** The browse catalogue: curated system practices plus the caller's own
 * customs, and nothing else (PT1 sharing ruling — someone else's custom
 * practice never appears in browse, even where RLS lets the caller read
 * it because a shared circle uses it). */
export async function listPracticesByCategory(
  category: PracticeCategory,
  userId: string
): Promise<Practice[]> {
  const { data, error } = await supabase
    .from('practices')
    .select(PRACTICE_SELECT)
    .eq('category', category)
    .eq('is_archived', false)
    .or(`created_by.is.null,created_by.eq.${userId}`)
    .order('name');

  if (error) throw error;
  return (data ?? []).map(mapPractice);
}

export async function createPractice(params: {
  name: string;
  category: PracticeCategory;
  practiceType: PracticeTypeKey;
  durationMinutes: number | null;
  createdBy: string;
}): Promise<Practice> {
  const { data, error } = await supabase
    .from('practices')
    .insert({
      name: params.name.trim(),
      category: params.category,
      practice_type: params.practiceType,
      duration_minutes: params.durationMinutes,
      created_by: params.createdBy,
    })
    .select(PRACTICE_SELECT)
    .single();

  if (error) throw error;
  return mapPractice(data);
}

/** Practices a person has authored themselves, for the Settings "My
 * practices" screen — includes archived ones so they can see what they
 * hid, but excluded from the category pickers everyone else browses. */
export async function listMyPractices(userId: string): Promise<Practice[]> {
  const { data, error } = await supabase
    .from('practices')
    .select(PRACTICE_SELECT)
    .eq('created_by', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapPractice);
}

export async function updatePractice(
  practiceId: string,
  params: {
    name: string;
    category: PracticeCategory;
    practiceType: PracticeTypeKey;
    durationMinutes: number | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from('practices')
    .update({
      name: params.name.trim(),
      category: params.category,
      practice_type: params.practiceType,
      duration_minutes: params.durationMinutes,
    })
    .eq('id', practiceId);

  if (error) throw error;
}

export async function archivePractice(practiceId: string): Promise<void> {
  const { error } = await supabase.from('practices').update({ is_archived: true }).eq('id', practiceId);
  if (error) throw error;
}

export async function createCircle(
  practiceKey: string,
  timeOfDay: string,
  circleName: string,
  isPublic: boolean
): Promise<{ circleId: string; inviteCode: string }> {
  const { data, error } = await supabase
    .rpc('create_circle', {
      p_practice_key: practiceKey,
      p_time_of_day: timeOfDay,
      p_circle_name: circleName,
      p_is_public: isPublic,
    })
    .single<{ circle_id: string; invite_code: string }>();

  if (error) {
    captureError(error, { rpc: 'create_circle' });
    throw error;
  }
  return { circleId: data.circle_id, inviteCode: data.invite_code };
}

export async function joinCircleByCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_circle_by_code', {
    code: code.trim().toUpperCase(),
  });

  if (error) {
    captureError(error, { rpc: 'join_circle_by_code' });
    throw error;
  }
  return data as string;
}

export type PublicCircle = {
  circleId: string;
  name: string;
  practiceName: string;
  memberCount: number;
  spotsLeft: number;
  dayNumber: number;
  durationDays: number;
};

/** Public circles the caller hasn't joined yet, newest first. Pass a
 * practiceId to see only circles running that specific practice. */
export async function listPublicCircles(practiceId?: string): Promise<PublicCircle[]> {
  const { data, error } = await supabase.rpc('list_public_circles', { p_practice_id: practiceId ?? null });
  if (error) {
    captureError(error, { rpc: 'list_public_circles' });
    throw error;
  }

  return (
    (data as {
      circle_id: string;
      name: string;
      practice_name: string;
      member_count: number;
      day_number: number;
      duration_days: number;
    }[]) ?? []
  ).map((row) => ({
    circleId: row.circle_id,
    name: row.name,
    practiceName: row.practice_name,
    memberCount: Number(row.member_count),
    spotsLeft: Math.max(0, CIRCLE_MEMBER_CAP - Number(row.member_count)),
    dayNumber: row.day_number,
    durationDays: row.duration_days,
  }));
}

export async function joinPublicCircle(circleId: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_public_circle', { p_circle_id: circleId });
  if (error) {
    captureError(error, { rpc: 'join_public_circle' });
    throw error;
  }
  return data as string;
}

/** Practice id -> count of public circles for it still open to join (under
 * the 12-member cap). A practice with no open circles has no entry at all
 * — callers should treat a missing key as "show nothing", never as 0. */
export async function countOpenCirclesByPractice(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('count_open_circles_by_practice');
  if (error) {
    captureError(error, { rpc: 'count_open_circles_by_practice' });
    throw error;
  }

  const counts: Record<string, number> = {};
  for (const row of (data as { practice_id: string; open_circles: number }[]) ?? []) {
    counts[row.practice_id] = Number(row.open_circles);
  }
  return counts;
}
