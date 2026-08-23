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

// ---------------------------------------------------------------------------
// AL1 job 3 (30 July) — the reminder goes FIRST, the nudge is the second
// chance.
//
// CAT'S RULING, 27 July, and it REPLACES AL1's own first draft, which
// suppressed the NS1 nudge outright for anyone with a declared time. The
// declared time does NOT silence the learned one: for an alarm-enabled
// person the day's nudge is HELD until a stated interval after the time
// they chose, and DROPPED if a check-in lands in between.
//
// NS1'S TIMING MATH IS UNTOUCHED. computeSmartSendTime above still decides
// the nudge's natural moment from the person's own rhythm; this function
// only ever moves that moment LATER, and only for someone who declared a
// time. Everyone else gets the identical string they got before AL1.

/**
 * How long after the declared time the nudge waits.
 *
 * THREE HOURS, and the reasoning rather than the number is the point.
 * It has to be long enough that the reminder had a fair chance — the
 * person set a time they intend to practise at, and a nudge arriving
 * twenty minutes later is not a second chance, it is the same poke twice
 * and the fastest way to get notifications turned off. Three hours covers
 * the ordinary "I'll do it after this meeting" slip without pretending
 * the day is over.
 *
 * And short enough to still land the same day: a 07:00 reminder nudges at
 * 10:00, a 12:00 one at 15:00, an 18:00 one at 21:00. Past roughly 20:00
 * the held time runs into the default 22:00 quiet window, and past 21:00
 * it crosses midnight — at which point resolveAlarmHeldSendTime says so
 * and the day simply gets no nudge. That is the right answer, not a gap:
 * a reminder at 21:00 whose "second chance" arrives at midnight would be
 * worse than silence.
 */
export const ALARM_NUDGE_HOLD_MINUTES = 180;

/** The nudge's effective due time once AL1's hold is applied.
 *
 * Returns "HH:MM" for the moment the nudge becomes due, or
 * "held_past_midnight" when the declared time plus the hold runs off the
 * end of the local day — the caller drops the day's nudge entirely rather
 * than wrapping it into tomorrow, where it would describe a day that has
 * already passed. An alarm-disabled person (or a corrupt time) gets the
 * smart send time back untouched.
 *
 * NEVER EARLIER, only later: the max() is what makes this a hold rather
 * than a reschedule. Someone whose learned rhythm already puts the nudge
 * after the held moment keeps their learned time exactly. */
export function resolveAlarmHeldSendTime(params: {
  smartSendTime: string;
  alarmEnabled: boolean;
  alarmTime: string | null | undefined;
  holdMinutes?: number;
}): string | "held_past_midnight" {
  const smart = params.smartSendTime.slice(0, 5);
  if (!params.alarmEnabled || !params.alarmTime) return smart;
  if (!/^\d{2}:\d{2}/.test(params.alarmTime)) return smart;

  const hold = params.holdMinutes ?? ALARM_NUDGE_HOLD_MINUTES;
  const heldMinutes = hhmmToMinutes(params.alarmTime) + hold;
  if (heldMinutes >= 1440) return "held_past_midnight";

  const held = minutesToHHMM(heldMinutes);
  return held > smart ? held : smart;
}

/** Quiet hours, applied to a due time. `quietStart`/`quietEnd` are
 * "HH:MM:SS" and so is `sendTime`.
 *
 * Returns 'skip' (the due time falls in the late/evening part of the
 * quiet window — don't send at all today), a clamped "HH:MM" (it falls
 * in the early/morning part — DELAY to quiet_end), or the original
 * "HH:MM" unchanged (no collision).
 *
 * MOVED HERE FROM index.ts BY CV3, unchanged line for line. It had
 * always been pure, but living inside a `Deno.serve` module meant Jest
 * could not import it, so the one place quiet hours are decided was the
 * one place no test could reach — and CV3's notice fires on the LAST
 * morning that a person can still be reached, where "held until 8am"
 * and "dropped for the day" are very different promises. A test that
 * re-implemented this arithmetic would have pinned the copy of the rule
 * rather than the rule.
 *
 * THE TWO OUTCOMES ARE NOT INTERCHANGEABLE, which is the whole reason
 * this is worth a test: a clamp HOLDS the notification (the composer
 * simply waits for local time to reach the returned hour, then enqueues
 * with scheduled_for = now()), while 'skip' LOSES it for that day. */
export function resolveSendTime(
  sendTime: string,
  quietStart: string,
  quietEnd: string
): string | "skip" {
  const send = sendTime.slice(0, 5);
  const start = quietStart.slice(0, 5);
  const end = quietEnd.slice(0, 5);
  if (start === end) return send; // quiet hours disabled
  const inWrappedWindow = start < end ? send >= start && send < end : send >= start || send < end;
  if (!inWrappedWindow) return send;
  // Within the window: the "late" half (>= start) never sends today; the
  // "early" half (< end) clamps forward to when quiet hours end.
  if (start < end) return send >= start ? "skip" : end;
  return send >= start ? "skip" : end;
}
