import { supabase } from './supabase';

export type PracticeCategory = 'move' | 'mind' | 'make' | 'learn';

export type Practice = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: PracticeCategory;
  durationMinutes: number | null;
  createdBy: string | null;
  isArchived: boolean;
};

const PRACTICE_SELECT = 'id, key, name, description, category, duration_minutes, created_by, is_archived';

function mapPractice(row: {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: PracticeCategory;
  duration_minutes: number | null;
  created_by: string | null;
  is_archived: boolean;
}): Practice {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    durationMinutes: row.duration_minutes,
    createdBy: row.created_by,
    isArchived: row.is_archived,
  };
}

export async function listPracticesByCategory(category: PracticeCategory): Promise<Practice[]> {
  const { data, error } = await supabase
    .from('practices')
    .select(PRACTICE_SELECT)
    .eq('category', category)
    .eq('is_archived', false)
    .order('name');

  if (error) throw error;
  return (data ?? []).map(mapPractice);
}

export async function createPractice(params: {
  name: string;
  category: PracticeCategory;
  durationMinutes: number | null;
  createdBy: string;
}): Promise<Practice> {
  const { data, error } = await supabase
    .from('practices')
    .insert({
      name: params.name.trim(),
      category: params.category,
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
  params: { name: string; category: PracticeCategory; durationMinutes: number | null }
): Promise<void> {
  const { error } = await supabase
    .from('practices')
    .update({
      name: params.name.trim(),
      category: params.category,
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

  if (error) throw error;
  return { circleId: data.circle_id, inviteCode: data.invite_code };
}

export async function joinCircleByCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_circle_by_code', {
    code: code.trim().toUpperCase(),
  });

  if (error) throw error;
  return data as string;
}

export type PublicCircle = {
  circleId: string;
  name: string;
  practiceName: string;
  memberCount: number;
  dayNumber: number;
  durationDays: number;
};

/** Public circles the caller hasn't joined yet, newest first. */
export async function listPublicCircles(): Promise<PublicCircle[]> {
  const { data, error } = await supabase.rpc('list_public_circles');
  if (error) throw error;

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
    dayNumber: row.day_number,
    durationDays: row.duration_days,
  }));
}

export async function joinPublicCircle(circleId: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_public_circle', { p_circle_id: circleId });
  if (error) throw error;
  return data as string;
}

/** Practice id -> count of public circles for it still open to join (under
 * the 12-member cap). A practice with no open circles has no entry at all
 * — callers should treat a missing key as "show nothing", never as 0. */
export async function countOpenCirclesByPractice(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('count_open_circles_by_practice');
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of (data as { practice_id: string; open_circles: number }[]) ?? []) {
    counts[row.practice_id] = Number(row.open_circles);
  }
  return counts;
}
