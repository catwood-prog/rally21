import { supabase } from './supabase';

// The personal glow (Rally21-Glow-Spec.md §1-2): consecutive local days
// with >=1 own completion in ANY circle. All streak math happens server-
// side in get_my_glow() — this module only shapes/relays the RPC result,
// it never computes streak logic itself.
export type GlowState = 'glowing' | 'embers' | 'cold';

/** PA3 — WHAT HELD A DAY, so the flame can say which (memo §5.3). A held
 * day is never "at risk": embers means at risk and a pebble has already
 * resolved it, so showing embers over a held day would be a warning about
 * a situation that no longer exists. */
export type HeldBy = 'away' | 'cover' | 'pebble';

export type Glow = {
  glow: number;
  state: GlowState;
  emberDeadline: string | null;
  heldToday: boolean;
  shelterUsed: number;
  shelterCapacity: number;
  /** PA3 — the nest (memo §5.2): 3 on joining, +1 every 3 days, cap 6, and
   * a friend's gift may push it OVER the cap. Server-derived on every
   * read; nothing client-side ever computes or caches a balance. */
  pebbles: number;
  /** What held TODAY, when today is held at all. */
  heldByToday: HeldBy | null;
  /** Kept permanently once a run ends (memo §5.1) — "you return to a live
   * number of 1 and a permanent record of 40". */
  longestRally: number;
  /** True when the run ended because a pebble-held gap reached six days.
   * Distinct from an ordinary cold: the pebble WAS the grace, so there is
   * no ember window to offer and nothing left to rescue. */
  endedAtCliff: boolean;
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
    pebbles: row?.pebbles ?? 0,
    heldByToday: (row?.held_by_today as HeldBy | null) ?? null,
    longestRally: row?.longest_rally ?? 0,
    endedAtCliff: row?.ended_at_cliff ?? false,
  };
}

/** The nest's cap (memo §5.2). Held here only so the give-a-pebble surface
 * can describe a full nest; the BALANCE itself is never computed client-
 * side — `getMyGlow().pebbles` is the one source, re-derived server-side
 * on every read exactly as the glow is. */
export const PEBBLE_CAP = 6;

/** Give one of your own pebbles to someone you share a circle with (memo
 * §5.2, job 3). The recipient's nest may go OVER the cap — the cap governs
 * regeneration, not generosity. Returns the giver's remaining balance,
 * re-derived by the server rather than decremented here. */
export async function giftPebble(circleId: string, recipientId: string): Promise<number> {
  const { data, error } = await supabase.rpc('gift_pebble', {
    p_circle_id: circleId,
    p_recipient: recipientId,
  });
  if (error) throw error;
  return (data as number | null) ?? 0;
}

/** Pebbles given to the caller that they have not been told about yet,
 * gated server-side against the SAME users.warmth_seen_at marker TN1
 * already uses for waves, hearts and covers. */
export async function getMyFreshPebbleGifts(): Promise<
  { senderId: string | null; senderName: string; senderAvatarUrl: string | null; at: string }[]
> {
  const { data, error } = await supabase.rpc('get_my_fresh_pebble_gifts');
  if (error) throw error;
  return (
    (data ?? []) as {
      sender_id: string | null;
      sender_name: string | null;
      sender_avatar_url: string | null;
      created_at: string;
    }[]
  ).map((r) => ({
    // AU1 job 3b/3c — the spot draws this person's real avatar and
    // merges their moments on the id, never on the name.
    senderId: r.sender_id ?? null,
    senderName: r.sender_name ?? 'someone in your circle',
    senderAvatarUrl: r.sender_avatar_url ?? null,
    at: r.created_at,
  }));
}

/** Records the permanent longest-rally journal fact when a run has ended
 * (memo §5.1), and returns that number on the ONE call that recorded it —
 * null every time after, so the sentence is shown once and never nags.
 * Detect-and-write, following check_glow_milestone: the glow READS stay
 * side-effect-free and this is the explicit call that writes. */
export async function recordMyRallyCliff(): Promise<number | null> {
  const { data, error } = await supabase.rpc('record_my_rally_cliff');
  if (error) throw error;
  return (data as number | null) ?? null;
}

// Friend streaks (Rally21-Glow-Spec.md §3, Personal-Arc memo §5.1) —
// app-level, not circle-level: days both people's own days counted
// toward their own glow. The shared circle is only how the pair forms.
//
// PA4 — TWO NUMBERS, AND WHICH ONE IS THE HEADLINE.
//
// `daysTogether` is the headline: the CUMULATIVE count of days you both
// qualified, ever. It never falls. A pair streak is jointly owned, so
// one person's absence must never destroy a number that was also
// someone else's (memo §5.1) — and the shipped consecutive-only number
// did exactly that, reading 0 for all eleven live pairs on 27 July
// because nobody's last shared day was yesterday.
//
// `streak` is the same consecutive run as before, unchanged in meaning
// and demoted to a small live flourish beside the headline. It may
// break without taking the friendship's worth with it.
//
// `sharedThisCircle` is the DISPLAY scope, deliberately separate from
// the data scope. The RPC returns every pair you have ever formed in
// any circle (that is what makes a friendship outlive the circle that
// formed it), while Glow-Spec §3 puts the headline "near who's-here,
// best among the members shown" — so the circle screen filters to pairs
// formed through THIS circle, INCLUDING someone who has since left.
export type PairStreak = {
  otherUserId: string;
  otherName: string;
  /** The live consecutive run — the fragile number, the flourish. */
  streak: number;
  /** The headline. Monotonic: it can only ever go up. */
  daysTogether: number;
  /** Whether this pair was formed through the circle being viewed. */
  sharedThisCircle: boolean;
};

type PairStreakRow = {
  other_user_id: string;
  other_name: string | null;
  streak: number;
  days_together: number;
  shared_this_circle: boolean;
};

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

// GS1 (17 July) — the glow goes social (Rally21-Glow-Spec.md §10).
// Hand-synced with the gs1_glow_goes_social migration's own floor: the
// server RPC ALREADY applies it (a sub-7 or away member is simply absent
// from the result — no sub-threshold number ever crosses the API); this
// client copy exists for display copy and future call sites, never as
// the enforcement point.
export const GLOW_SOCIAL_VISIBLE_FROM_DAYS = 7;

/** Who's Here's glow ride-along: day counts for every circle-mate at
 * 7+ days glowing (and not away), keyed by user id. Circle-mates only,
 * enforced at the database — the RPC takes the circle id, derives the
 * member list itself (no arbitrary-uuid reads), and returns nothing at
 * all to a non-member. One batch call per circle, never per member. */
export async function getGlowForCircleMates(circleId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('get_glow_for_circle_mates', { p_circle_id: circleId });
  if (error) throw error;
  return new Map(
    ((data ?? []) as { user_id: string; glow: number }[]).map((row) => [row.user_id, row.glow])
  );
}

/** Every friendship the caller has formed, in any circle they have ever
 * shared — the pair list outlives the circle (Glow-Spec §3), because
 * `leave_circle` hard-deletes the membership row but never the
 * completions, so the server derives pairs from both.
 *
 * The circle id is an AUTHORIZATION ANCHOR, not a scope: you must be a
 * current member of the circle you name before the server tells you
 * anything, and a non-member gets an exception exactly as before. The
 * server derives the peer list from `auth.uid()` alone — there is no
 * parameter naming a user, so no arbitrary-uuid read exists to make. */
export async function getPairStreaks(circleId: string): Promise<PairStreak[]> {
  const { data, error } = await supabase.rpc('get_pair_streaks', { p_circle_id: circleId });
  if (error) throw error;
  return ((data ?? []) as PairStreakRow[]).map((row) => ({
    otherUserId: row.other_user_id,
    otherName: row.other_name ?? 'circle-mate',
    streak: row.streak,
    daysTogether: row.days_together,
    sharedThisCircle: row.shared_this_circle,
  }));
}

// The glow moment (G5, Rally21-Glow-Spec.md §1) — the post-check-in
// week row. States mirror get_week_for_user()'s own shelter-capacity
// accounting exactly, so this never disagrees with getMyGlow()'s number.
export type WeekDayState = 'earned' | 'held' | 'none';
/** PA3 — `state` is UNCHANGED and still the three shipped values; the
 * memo's instruction was to extend this vocabulary to the flame, not to
 * add a fourth day state. `heldBy` rides alongside so a pebble-held day
 * can show the pebble as its marker where a covered day shows the heart
 * (memo §5.3). Null on any day that is not held. */
export type WeekDay = { date: string; state: WeekDayState; heldBy: HeldBy | null };

type WeekDayRow = { day_date: string; state: string; held_by: string | null };

/** The last 7 local days (oldest first, today last), for the glow
 * moment's week row. All streak/shelter-capacity math happens
 * server-side — this only shapes the RPC result. */
export async function getMyWeek(): Promise<WeekDay[]> {
  const { data, error } = await supabase.rpc('get_my_week');
  if (error) throw error;
  return ((data ?? []) as WeekDayRow[]).map((row) => {
    const state: WeekDayState = row.state === 'earned' || row.state === 'held' ? row.state : 'none';
    const heldBy =
      row.held_by === 'away' || row.held_by === 'cover' || row.held_by === 'pebble'
        ? row.held_by
        : null;
    return { date: row.day_date, state, heldBy: state === 'held' ? heldBy : null };
  });
}

/** The G3/G5 composition rule: a milestone day always shows the
 * milestone celebration instead of the glow moment (never both) —
 * checked first. Otherwise the glow moment shows only on the check-in
 * that actually earned the day (the user's first own completion of the
 * local date) — never a second-circle completion, never an edit. */
export function shouldShowGlowBeat(params: { earnedToday: boolean; hasMilestone: boolean }): boolean {
  if (params.hasMilestone) return false;
  return params.earnedToday;
}

/** Whether today's earned day rekindled the glow from embers — derived
 * purely from the week row rather than a separate server flag: a
 * missed, uncovered day always reads 'none' (get_week_for_user uses the
 * same day-state logic regardless of the ember window), so "yesterday
 * none, today earned" is exactly the rekindle pattern (Rally21-Glow-Spec
 * §2's 48h window always includes the very next day). */
export function didRekindleToday(week: WeekDay[]): boolean {
  if (week.length < 2) return false;
  const today = week[week.length - 1];
  const yesterday = week[week.length - 2];
  return today.state === 'earned' && yesterday.state === 'none';
}
