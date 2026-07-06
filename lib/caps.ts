import { supabase } from './supabase';

// Single source of truth for the two membership caps — the actual
// enforcement lives server-side in the `app_caps()` SQL function used by
// create_circle, join_circle_by_code, join_public_circle, and
// count_open_circles_by_practice. These are the product defaults for
// display when the server hasn't been asked (e.g. before first load).
export const MAX_CIRCLES = 3;
export const CIRCLE_MEMBER_CAP = 12;

/**
 * Fetches the real max-circles-per-user cap for the current session.
 * app_caps() is auth.uid()-aware server-side — it returns the product
 * default (3) for everyone except a narrow founder allowlist, which gets
 * a higher personal cap so Cat can run more circles while inviting the
 * friends cohort. Falls back to MAX_CIRCLES if the call fails so the UI
 * never breaks.
 */
export async function getMyCircleCap(): Promise<number> {
  const { data, error } = await supabase.rpc('app_caps');
  if (error || !data || !data[0]) return MAX_CIRCLES;
  return data[0].max_circles_per_user ?? MAX_CIRCLES;
}
