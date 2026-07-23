import { PracticeDomain } from './practiceTaxonomy';
import { supabase } from './supabase';

// ON1 (23 July) — the two-question Day-0 intake. Q1 (desired change) is
// stored on the user and pre-filters the practice browse; Q2 (obstacle) is
// stored on the membership and names the mechanic the Day-0 sentence
// surfaces. Both self-reported ("you told us"), never the map's "we
// noticed" voice. This module is the single source of the option sets and
// the Q1→domain rule; the user-facing copy lives in constants/strings.ts.

export type DesiredChange = 'move' | 'mind' | 'learn' | 'make' | 'care' | 'connection';
export type KeepGoingObstacle = 'forget' | 'no_time' | 'lose_motivation' | 'miss_once' | 'alone';

// Q1's five practice domains come FROM the PT1 taxonomy (PracticeDomain) —
// never re-listed here — plus the one non-domain option, 'connection'.
export const DESIRED_CHANGE_KEYS: DesiredChange[] = ['move', 'mind', 'learn', 'make', 'care', 'connection'];
export const OBSTACLE_KEYS: KeepGoingObstacle[] = [
  'forget',
  'no_time',
  'lose_motivation',
  'miss_once',
  'alone',
];

export function isDesiredChange(v: string | null | undefined): v is DesiredChange {
  return !!v && (DESIRED_CHANGE_KEYS as string[]).includes(v);
}

export function isObstacle(v: string | null | undefined): v is KeepGoingObstacle {
  return !!v && (OBSTACLE_KEYS as string[]).includes(v);
}

/** Q1 → the practice-browse domain to pre-select. The five PT1 domains map
 * 1:1 to PracticeDomain; 'connection' is answered by the circle itself, not
 * a practice domain, so it returns null (no domain filter — the invite step
 * is emphasized instead). This is the ONLY definition of the Q1→domain
 * rule, so the browse and any test read the same thing. */
export function domainForDesiredChange(key: DesiredChange): PracticeDomain | null {
  return key === 'connection' ? null : key;
}

/** Q1 write — the caller's own user row, via the existing own-row users
 * UPDATE policy (same path as every other profile field). */
export async function setOnboardingDesiredChange(userId: string, key: DesiredChange): Promise<void> {
  const { error } = await supabase.from('users').update({ onboarding_desired_change: key }).eq('id', userId);
  if (error) throw error;
}

/** Q2 write — the caller's own membership row, via the SECURITY DEFINER
 * RPC (memberships has no client UPDATE policy by design). */
export async function setKeepGoingObstacle(circleId: string, obstacle: KeepGoingObstacle): Promise<void> {
  const { error } = await supabase.rpc('set_keep_going_obstacle', {
    p_circle_id: circleId,
    p_obstacle: obstacle,
  });
  if (error) throw error;
}
