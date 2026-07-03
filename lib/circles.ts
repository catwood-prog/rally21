import { supabase } from './supabase';

export type Practice = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

export async function listPractices(): Promise<Practice[]> {
  const { data, error } = await supabase
    .from('practices')
    .select('id, key, name, description')
    .order('name');

  if (error) throw error;
  return data ?? [];
}

export async function createCircle(
  practiceKey: string,
  timeOfDay: string
): Promise<{ circleId: string; inviteCode: string }> {
  const { data, error } = await supabase
    .rpc('create_circle', { p_practice_key: practiceKey, p_time_of_day: timeOfDay })
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
