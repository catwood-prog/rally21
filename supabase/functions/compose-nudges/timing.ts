// NS1 (13 July) — smart nudge timing. Pure, portable logic only — no
// Deno imports — so this file is directly Jest-testable, mirroring
// ask-rally/context.ts's split. Deterministic by construction: same
// user + same local date always computes the identical send time on
// re-run (idempotent), exactly like Q1's md5 tiebreak and the share-card
// cadence's own weekly schedule pick.

/** How far before the user's own learned usual check-in time to aim the
 * nudge — a timely "before you usually do it" reminder, never after. */
export const LEAD_MINUTES_BEFORE_USUAL_TIME = 20;

/** The jitter band (±minutes) around the learned target, so the exact
 * send minute is never the same two days running — the robotic
 * exact-same-minute pattern Duolingo's own send-time behavior avoids. */
export const JITTER_BAND_MINUTES = 8;

/** Below this many recent completions, there isn't enough signal to
 * learn a real pattern from — fall back to the set reminder time / the
 * circle's own practice time, unjittered, rather than guess wildly. */
export const MIN_SAMPLE_SIZE = 5;

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

export function minutesToHHMM(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A robust center (not mean) — one 2am insomnia check-in in the sample
 * shouldn't drag the learned time toward it. Even-length samples average
 * the two middle values, which is still a whole number of minutes after
 * rounding. Doesn't handle a sample clustered across the midnight
 * boundary specially (a deliberate v1 scope limit — see DEFERRED.md). */
export function medianMinutes(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return sorted[mid];
}

/** Deterministic per-user-per-day offset seeded from user_id + local
 * date, mapped into [-band, +band] inclusive. Same seed string always
 * produces the same offset; a different local_date almost always
 * produces a different one. */
export function jitterMinutes(seedStr: string, bandMinutes: number): number {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const span = bandMinutes * 2 + 1;
  return (seed % span) - bandMinutes;
}

/** The learned + jittered send time, or the untouched cold-start
 * fallback when there isn't enough history yet. `fallbackTime` is
 * "HH:MM" or "HH:MM:SS" — today's existing default (the set reminder
 * time, or the circle's own practice time when no reminder is set). */
export function computeSmartSendTime(params: {
  timeOfDaySamplesMinutes: number[];
  fallbackTime: string;
  userId: string;
  localDate: string;
  minSampleSize?: number;
  leadMinutes?: number;
  jitterBandMinutes?: number;
}): string {
  const minSample = params.minSampleSize ?? MIN_SAMPLE_SIZE;
  const lead = params.leadMinutes ?? LEAD_MINUTES_BEFORE_USUAL_TIME;
  const band = params.jitterBandMinutes ?? JITTER_BAND_MINUTES;

  const median =
    params.timeOfDaySamplesMinutes.length >= minSample ? medianMinutes(params.timeOfDaySamplesMinutes) : null;

  if (median === null) {
    // Cold start: exactly the existing default, never jittered, never a
    // wild guess.
    return params.fallbackTime.slice(0, 5);
  }

  const target = median - lead;
  const jitter = jitterMinutes(`${params.userId}||${params.localDate}`, band);
  return minutesToHHMM(target + jitter);
}
