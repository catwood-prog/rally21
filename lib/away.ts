import { supabase } from './supabase';

/** RS2 (Rally21-Glow-Spec.md §9) — the away pause. Person-level,
 * self-serve: `users.away_since` is the only live-state column; going
 * away is a plain self-update (same pattern as saveBirthday/
 * setCelebrateBirthday in lib/profile.ts). Returning always goes
 * through the return_from_away() RPC (not a plain update), since it
 * also durably backfills the away gap as 'away'-kind completions rows
 * so the glow/week/pair-streak protection survives long after
 * away_since itself is cleared — see the migration's own comments. */
export async function setAway(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ away_since: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

/** "I'm back" — the explicit settings-toggle return path. "Simply
 * checking in" is the other, wired directly into lib/checkin.ts's
 * saveCompletion instead of here. Idempotent no-op if not currently
 * away. */
export async function returnFromAway(): Promise<void> {
  const { error } = await supabase.rpc('return_from_away');
  if (error) throw error;
}
