import { supabase } from './supabase';

// The personal glow (Rally21-Glow-Spec.md §1-2): consecutive local days
// with >=1 own completion in ANY circle. All streak math happens server-
// side in get_my_glow() — this module only shapes/relays the RPC result,
// it never computes streak logic itself.
export type GlowState = 'glowing' | 'embers' | 'cold';

export type Glow = {
  glow: number;
  state: GlowState;
  emberDeadline: string | null;
  heldToday: boolean;
  shelterUsed: number;
  shelterCapacity: number;
};

export async function getMyGlow(): Promise<Glow> {
  const { data, error } = await supabase.rpc('get_my_glow');
  if (error) throw error;
  const row = data?.[0];
  return {
    glow: row?.glow ?? 0,
    state: row?.state ?? 'glowing',
    emberDeadline: row?.ember_deadline ?? null,
    heldToday: row?.held_today ?? false,
    shelterUsed: row?.shelter_used ?? 0,
    shelterCapacity: row?.shelter_capacity ?? 1,
  };
}

// Friend streaks (Rally21-Glow-Spec.md §3) — app-level, not circle-level:
// consecutive days both people's own days counted toward their own glow.
// The shared circle is only how the pair forms.
export type PairStreak = {
  otherUserId: string;
  otherName: string;
  streak: number;
};

type PairStreakRow = { other_user_id: string; other_name: string | null; streak: number };

// Glow milestones (Rally21-Glow-Spec.md §4) — 7/21/50/100/365. Detected
// server-side at check-in time (never on a plain get_my_glow() read,
// which stays side-effect-free); a monotonic tracker means this can
// never refire, including after an ember-rekindle passes back through
// an already-celebrated milestone.
export async function checkGlowMilestone(): Promise<number | null> {
  const { data, error } = await supabase.rpc('check_glow_milestone');
  if (error) throw error;
  return data ?? null;
}

export async function getPairStreaks(circleId: string): Promise<PairStreak[]> {
  const { data, error } = await supabase.rpc('get_pair_streaks', { p_circle_id: circleId });
  if (error) throw error;
  return ((data ?? []) as PairStreakRow[]).map((row) => ({
    otherUserId: row.other_user_id,
    otherName: row.other_name ?? 'circle-mate',
    streak: row.streak,
  }));
}
