import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// The daily-nudge composer (Notifications spec §3, Part B). Runs on the
// same 15-min pg_cron cadence as send-notifications but is a separate
// function: this one decides WHAT to say and WHEN it's due (per user,
// once per local date); send-notifications still owns WHETHER/HOW to
// actually deliver it, including a final at-send recheck (already
// checked in? still have active circles? quiet hours?) since a row can
// sit briefly between being enqueued and being sent.
//
// Rather than compute an exact future UTC send instant (real IANA
// timezone-to-UTC conversion needs a library Deno doesn't ship), this
// composer runs every 15 min and only enqueues a row once local time has
// reached the (quiet-hours-adjusted) send time — at that point it
// inserts with scheduled_for = now(), so send-notifications picks it up
// on its very next tick. `dedupe_key = nudge-{user}-{local_date}` with
// the outbox's existing unique constraint guarantees exactly one row per
// user per local date even though this function re-evaluates everyone
// every 15 minutes.

// Kept in exact sync by hand with constants/strings.ts's NUDGE_WARM_LINES
// / NUDGE_RESTART_LINES — this edge function is a standalone Deno file
// with no access to that module graph.
const WARM_LINES = [
  "no pressure — just today's little thing, whenever you get to it.",
  'your circle showed up for you before. today, maybe you show up for them.',
  "small and steady beats big and never. today's a small day.",
  'nobody is keeping score. this is just an invitation.',
  "a couple minutes, a couple lines — that's the whole ask.",
  'the circle is quietly rooting for you, no pressure attached.',
  "today's version of you only needs to do today's version of the thing.",
  'showing up messy still counts as showing up.',
];
const RESTART_LINES = [
  'Day 1s are allowed. Tonight counts.',
  'every day is a fine day to start again.',
  'no catching up required — just today.',
  "today's a clean page. that's all it needs to be.",
];

// Kept in exact sync by hand with constants/strings.ts's
// PRACTICE_VERB_STARTERS / isVerbPhrasePractice.
const PRACTICE_VERB_STARTERS = [
  'meditate', 'walk', 'run', 'write', 'stretch', 'sit', 'breathe', 'read',
  'journal', 'draw', 'move', 'practice', 'do',
];
function isVerbPhrasePractice(practiceName: string): boolean {
  const firstWord = practiceName.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
  return !!firstWord && PRACTICE_VERB_STARTERS.includes(firstWord);
}

function localDateString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

function localTimeString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour")!.value;
  const min = parts.find((p) => p.type === "minute")!.value;
  return `${h}:${min}`;
}

/** One calendar day before `dateStr` (YYYY-MM-DD), computed in UTC so it's
 * never skewed by DST — mirrors lib/date.ts's daysBetween approach. */
function dayBefore(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
}

/** quiet_start/quiet_end are "HH:MM:SS"; sendTime is "HH:MM:SS".
 * Returns 'skip' (send time falls in the late/evening part of the quiet
 * window — don't send at all today), a clamped "HH:MM" (send time falls
 * in the early/morning part — delay to quiet_end), or the original
 * "HH:MM" unchanged (no collision). */
function resolveSendTime(sendTime: string, quietStart: string, quietEnd: string): string | "skip" {
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

/** Simple deterministic index so the same user/day doesn't reshuffle
 * lines on a retried run within the same 15-min window. */
function pick<T>(arr: T[], seedStr: string): T {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  return arr[seed % arr.length];
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: expectedSecret } = await admin.rpc("get_notifications_secret");
  const providedSecret = req.headers.get("x-notifications-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const now = new Date();
  const summary = { candidates: 0, enqueued: 0, skippedNoCircles: 0, skippedQuietHours: 0, notYetDue: 0 };

  const { data: candidates, error: candidatesError } = await admin
    .from("users")
    .select("id, timezone, notification_prefs!inner(nudge_enabled, nudge_time, quiet_start, quiet_end)")
    .eq("notification_prefs.nudge_enabled", true)
    .not("timezone", "is", null);

  if (candidatesError) {
    console.error("Could not load nudge candidates:", candidatesError.message);
    return new Response(JSON.stringify({ error: candidatesError.message }), { status: 500 });
  }

  for (const user of candidates ?? []) {
    summary.candidates++;
    try {
      const prefs = Array.isArray(user.notification_prefs) ? user.notification_prefs[0] : user.notification_prefs;
      const timeZone = user.timezone as string;

      const { data: circles } = await admin
        .from("memberships")
        .select("circles!inner(time_of_day, is_active, completed_at, practices(name))")
        .eq("user_id", user.id)
        .eq("circles.is_active", true);

      // A completed circle (Rally21-Glow-Spec.md §8) is warmly archived,
      // read-only history — it never sends a daily nudge again, journey
      // ladder or not.
      const activeCircles = (circles ?? [])
        .map((row: any) => ({
          timeOfDay: row.circles?.time_of_day as string | null,
          completedAt: row.circles?.completed_at as string | null,
          practiceName: row.circles?.practices?.name as string | undefined,
        }))
        .filter((c) => !!c.timeOfDay && !c.completedAt)
        .sort((a, b) => a.timeOfDay!.localeCompare(b.timeOfDay!));

      if (activeCircles.length === 0) {
        summary.skippedNoCircles++;
        continue;
      }

      const rawSendTime = prefs.nudge_time ?? activeCircles[0].timeOfDay!;
      const resolved = resolveSendTime(rawSendTime, prefs.quiet_start, prefs.quiet_end);
      if (resolved === "skip") {
        summary.skippedQuietHours++;
        continue;
      }

      const localDate = localDateString(now, timeZone);
      const localTime = localTimeString(now, timeZone);
      if (localTime < resolved) {
        summary.notYetDue++;
        continue;
      }

      const dedupeKey = `nudge-${user.id}-${localDate}`;

      const practiceNames = activeCircles.map((c) => c.practiceName ?? 'your practice');
      let subject: string;
      if (practiceNames.length > 1) {
        subject = 'two small things today 🔥';
      } else {
        const name = practiceNames[0];
        subject = isVerbPhrasePractice(name)
          ? `today you ${name.toLowerCase()} — with your circle 🔥`
          : `today: ${name.toLowerCase()}, with your circle 🔥`;
      }

      const yesterday = dayBefore(localDate);
      const { count: yesterdayCompletions } = await admin
        .from("completions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("local_date", yesterday);
      const missedYesterday = (yesterdayCompletions ?? 0) === 0;
      const line = missedYesterday ? pick(RESTART_LINES, dedupeKey) : pick(WARM_LINES, dedupeKey);

      const practiceList = practiceNames.map((n) => `<li>${n}</li>`).join("");
      const html = `<p>${practiceNames.length > 1 ? 'Today, with your circles:' : 'Today, with your circle:'}</p>
<ul>${practiceList}</ul>
<p>${line}</p>
<p><a href="https://rally21.vercel.app">open Rally21</a></p>`;

      const { error: insertError } = await admin
        .from("notification_outbox")
        .insert({
          user_id: user.id,
          kind: "nudge_daily",
          // local_date lets send-notifications refuse to deliver this once
          // the recipient's calendar date has moved on — a row held by
          // quiet hours overnight must never arrive describing a day that
          // has already passed (see send-notifications' expiry check).
          payload: { subject, html, local_date: localDate },
          scheduled_for: now.toISOString(),
          dedupe_key: dedupeKey,
        });

      // A unique-violation here just means another run already enqueued
      // today's nudge for this user — not an error, exactly the dedupe
      // this key exists to guarantee.
      if (insertError && insertError.code !== "23505") {
        console.error(`Could not enqueue nudge for user ${user.id}:`, insertError.message);
        continue;
      }
      if (!insertError) summary.enqueued++;
    } catch (e) {
      console.error(`Unhandled error composing nudge for user ${user.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
});
