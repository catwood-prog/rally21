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
