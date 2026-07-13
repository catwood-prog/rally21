import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// The evening social-digest composer (Notifications spec §4, Part C).
// Same 15-min pg_cron cadence + per-user local-time-aware pattern as
// compose-nudges: only enqueues once local time reaches 19:00 (quiet-
// hours-adjusted), once per local date (dedupe_key). Unlike the daily
// nudge, this composer also decides WHETHER there's anything worth
// sending at all — "only if events occurred since last_seen_at" (spec
// §4) — so a quiet day produces no row, not a "nothing happened" email.

const DIGEST_SEND_TIME = "19:00";

// The journey ladder's major stops (Rally21-Glow-Spec.md §8) — rally
// markers (every 21 days) stay in-app only, never in the digest.
const MAJOR_STOPS = [50, 100, 365];

// Friend/pair streak milestones (Rally21-Glow-Spec.md §3).
const PAIR_STREAK_MILESTONES = [7, 21, 50, 100, 200, 365];

/** One calendar day before `dateStr` (YYYY-MM-DD), computed in UTC so
 * it's never skewed by DST — mirrors compose-nudges' own helper. */
function dayBefore(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
}

/** A circle's day number as of a given instant — day math only, no
 * per-user timezone precision needed for a once-daily congratulatory
 * line (a day off either way is harmless). */
function dayNumberAt(startDate: string, atMs: number): number {
  const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
  return Math.floor((atMs - startMs) / 86400000) + 1;
}

// The mascot brief's only email placement — cover-a-friend.png, once per
// digest max, only when the digest actually contains a covered/wave line
// (not just wall-message activity). Hash is content-addressed by the web
// build; only changes if the source image itself is ever replaced.
const COVER_A_FRIEND_IMAGE_URL =
  "https://rally21.vercel.app/assets/assets/mascot/cover-a-friend.dbaae2c7f7e7900e543eef8727e86089.png";

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

/** Mirrors compose-nudges' resolveSendTime for a FIXED target time
 * (19:00, not user-configurable per spec) — a morning collision can't
 * happen at 7pm, but a custom quiet-hours window could still swallow
 * it, so the same clamp/skip rule applies for consistency. */
function resolveSendTime(sendTime: string, quietStart: string, quietEnd: string): string | "skip" {
  const send = sendTime.slice(0, 5);
  const start = quietStart.slice(0, 5);
  const end = quietEnd.slice(0, 5);
  if (start === end) return send;
  const inWrappedWindow = start < end ? send >= start && send < end : send >= start || send < end;
  if (!inWrappedWindow) return send;
  if (start < end) return send >= start ? "skip" : end;
  return send >= start ? "skip" : end;
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: expectedSecret } = await admin.rpc("get_notifications_secret");
  const providedSecret = req.headers.get("x-notifications-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const now = new Date();
  const summary = {
    candidates: 0,
    enqueued: 0,
    skippedNoEvents: 0,
    skippedQuietHours: 0,
    notYetDue: 0,
    skippedAway: 0,
  };

  const { data: candidates, error: candidatesError } = await admin
    .from("users")
    .select("id, timezone, last_seen_at, away_since, notification_prefs!inner(digest_enabled, quiet_start, quiet_end)")
    .eq("notification_prefs.digest_enabled", true)
    .not("timezone", "is", null)
    .not("last_seen_at", "is", null);

  if (candidatesError) {
    console.error("Could not load digest candidates:", candidatesError.message);
    return new Response(JSON.stringify({ error: candidatesError.message }), { status: 500 });
  }

  for (const user of candidates ?? []) {
    summary.candidates++;
    try {
      // RS2 (Rally21-Glow-Spec.md §9) — away means no digest either, even
      // though nothing "warm happened" reasoning would otherwise disagree.
      if (user.away_since) {
        summary.skippedAway++;
        continue;
      }

      const prefs = Array.isArray(user.notification_prefs) ? user.notification_prefs[0] : user.notification_prefs;
      const timeZone = user.timezone as string;

      const resolved = resolveSendTime(DIGEST_SEND_TIME, prefs.quiet_start, prefs.quiet_end);
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

      const dedupeKey = `digest-${user.id}-${localDate}`;
      const lastSeenAt = user.last_seen_at as string;

      // Circles this user belongs to — needed for the wall-message count
      // and check-in headcount lines below.
      const { data: memberships } = await admin
        .from("memberships")
        .select(
          "circles!inner(id, name, is_active, start_date, rallied_on_at, completed_at, practices(name))"
        )
        .eq("user_id", user.id);

      const activeCircles = (memberships ?? [])
        .map((row: any) => ({
          id: row.circles?.id as string,
          name: row.circles?.name as string,
          isActive: row.circles?.is_active as boolean,
          startDate: row.circles?.start_date as string,
          ralliedOnAt: row.circles?.rallied_on_at as string | null,
          completedAt: row.circles?.completed_at as string | null,
          practiceName: row.circles?.practices?.name as string | undefined,
        }))
        .filter((c) => c.isActive);

      if (activeCircles.length === 0) {
        summary.skippedNoEvents++;
        continue;
      }
      const circleIds = activeCircles.map((c) => c.id);

      // Covered: someone logged this user's day for them, since last seen.
      const { data: covered } = await admin
        .from("completions")
        .select("circle_id, covered_by, created_at")
        .eq("user_id", user.id)
        .eq("kind", "covered")
        .gt("created_at", lastSeenAt);

      const covererIds = Array.from(new Set((covered ?? []).map((c) => c.covered_by).filter(Boolean)));
      const covererNames = new Map<string, string>();
      if (covererIds.length > 0) {
        const { data: coverers } = await admin.from("users").select("id, name").in("id", covererIds as string[]);
        for (const c of coverers ?? []) covererNames.set(c.id, c.name ?? "someone in your circle");
      }

      // Waves (friend nudges) received since last seen.
      const { data: waves } = await admin
        .from("notification_outbox")
        .select("payload, created_at")
        .eq("user_id", user.id)
        .eq("kind", "friend_nudge")
        .gt("created_at", lastSeenAt);

      const waverIds = Array.from(
        new Set((waves ?? []).map((w: any) => w.payload?.waverId).filter(Boolean))
      );
      const waverNames = new Map<string, string>();
      if (waverIds.length > 0) {
        const { data: wavers } = await admin.from("users").select("id, name").in("id", waverIds as string[]);
        for (const w of wavers ?? []) waverNames.set(w.id, w.name ?? "someone in your circle");
      }

      // New wall messages (from others) since last seen — count only,
      // never contents (spec §4: privacy).
      const { count: wallCount } = await admin
        .from("wall_messages")
        .select("id", { count: "exact", head: true })
        .in("circle_id", circleIds)
        .neq("user_id", user.id)
        .gt("created_at", lastSeenAt);

      // Journey ladder events since last seen — the day-21 gate answer
      // (either outcome) and any major stop (50/100/365) crossed.
      // Server-computed from the circle's own timestamps/start_date, not
      // per-member last_celebrated_day, so a major stop still makes the
      // digest even if the member hasn't opened the app to see the
      // celebration screen yet.
      const nowMs = now.getTime();
      const lastSeenMs = new Date(lastSeenAt).getTime();
      const journeyLines: string[] = [];
      for (const c of activeCircles) {
        if (c.completedAt && new Date(c.completedAt).getTime() > lastSeenMs) {
          journeyLines.push(`${c.name} completed its 21 days together ✨`);
          continue;
        }
        if (c.ralliedOnAt && new Date(c.ralliedOnAt).getTime() > lastSeenMs) {
          journeyLines.push(`${c.name} rallied on past day 21 🔥`);
        }
        if (c.ralliedOnAt && !c.completedAt) {
          const dayNow = dayNumberAt(c.startDate, nowMs);
          const dayAtLastSeen = dayNumberAt(c.startDate, lastSeenMs);
          for (const stop of MAJOR_STOPS) {
            if (stop > dayAtLastSeen && stop <= dayNow) {
              journeyLines.push(`${c.name} made it to ${stop} days 🔥`);
            }
          }
        }
      }

      // Friend/pair streak milestones (Rally21-Glow-Spec.md §3) —
      // compare today vs yesterday, not lastSeenAt: this composer already
      // runs once daily, so "crossed since yesterday" is exactly "today".
      // Never a line about a streak ending (spec §5).
      const { data: circleMemberRows } = await admin
        .from("memberships")
        .select("user_id")
        .in("circle_id", circleIds)
        .neq("user_id", user.id);

      const otherMemberIds = Array.from(new Set((circleMemberRows ?? []).map((m) => m.user_id as string)));
      const pairLines: string[] = [];
      // BD1 — a quiet birthday line for circle-mates. Supplementary only: it
      // rides along an already-firing digest and is deliberately NOT counted
      // toward triggeringCount, so a birthday alone never sends a standalone
      // email (spec §4c). Resolved against each celebrant's OWN timezone.
      const birthdayLines: string[] = [];
      if (otherMemberIds.length > 0) {
        const { data: otherUsers } = await admin
          .from("users")
          .select("id, name, birth_month, birth_day, celebrate_birthday, timezone")
          .in("id", otherMemberIds);
        const otherNameById = new Map<string, string>();
        for (const u of otherUsers ?? []) otherNameById.set(u.id, u.name ?? "someone in your circle");

        for (const u of otherUsers ?? []) {
          if (!u.celebrate_birthday || u.birth_month == null || u.birth_day == null) continue;
          const theirLocalDate = localDateString(now, (u.timezone as string | null) ?? timeZone);
          const [, m, d] = theirLocalDate.split("-").map(Number);
          if (m === u.birth_month && d === u.birth_day) {
            birthdayLines.push(`it's ${u.name ?? "someone in your circle"}'s birthday today 🎂`);
          }
        }

        for (const otherId of otherMemberIds) {
          const [{ data: todayStreak }, { data: yesterdayStreak }] = await Promise.all([
            admin.rpc("get_pair_streak_between", { p_user1: user.id, p_user2: otherId, p_through: localDate }),
            admin.rpc("get_pair_streak_between", {
              p_user1: user.id,
              p_user2: otherId,
              p_through: dayBefore(localDate),
            }),
          ]);
          const todayVal = (todayStreak as number | null) ?? 0;
          const yesterdayVal = (yesterdayStreak as number | null) ?? 0;
          for (const milestone of PAIR_STREAK_MILESTONES) {
            if (todayVal >= milestone && yesterdayVal < milestone) {
              pairLines.push(`you and ${otherNameById.get(otherId) ?? "someone in your circle"} hit ${milestone} days together 🔥`);
            }
          }
        }
      }

      // Personal glow milestones (Rally21-Glow-Spec.md §4) — written in
      // real time by check_glow_milestone() at check-in, so (unlike the
      // journey ladder's major stops) querying "since last seen" is
      // reliable here: there's no lazy client-visit dependency.
      const { data: glowMilestoneFacts } = await admin
        .from("journal_facts")
        .select("body, created_at")
        .eq("user_id", user.id)
        .eq("kind", "glow_milestone")
        .gt("created_at", lastSeenAt);

      const glowMilestoneLines = (glowMilestoneFacts ?? []).map((f) => `${f.body} 🔥`);

      const triggeringCount =
        (covered?.length ?? 0) +
        (waves?.length ?? 0) +
        (wallCount ?? 0) +
        journeyLines.length +
        pairLines.length +
        glowMilestoneLines.length;
      if (triggeringCount === 0) {
        summary.skippedNoEvents++;
        continue;
      }

      // Today's check-in headcount per active circle — supplementary
      // context once the digest is already firing, not itself a trigger
      // (otherwise nearly every day would qualify, which is exactly the
      // "ten pings" noise the spec's principles rule out).
      const { data: todaysCompletions } = await admin
        .from("completions")
        .select("circle_id, user_id")
        .in("circle_id", circleIds)
        .eq("local_date", localDate);

      const { data: memberCounts } = await admin
        .from("memberships")
        .select("circle_id")
        .in("circle_id", circleIds);

      const memberCountByCircle = new Map<string, number>();
      for (const m of memberCounts ?? []) {
        memberCountByCircle.set(m.circle_id, (memberCountByCircle.get(m.circle_id) ?? 0) + 1);
      }
      const checkedInByCircle = new Map<string, Set<string>>();
      for (const c of todaysCompletions ?? []) {
        if (!checkedInByCircle.has(c.circle_id)) checkedInByCircle.set(c.circle_id, new Set());
        checkedInByCircle.get(c.circle_id)!.add(c.user_id);
      }

      const lines: string[] = [...birthdayLines, ...journeyLines, ...pairLines, ...glowMilestoneLines];
      for (const c of covered ?? []) {
        const name = covererNames.get(c.covered_by as string) ?? "someone in your circle";
        lines.push(`${name} covered you today 💛 — "no pressure, we've got you"`);
      }
      for (const w of waves ?? []) {
        const name = waverNames.get((w as any).payload?.waverId) ?? "someone in your circle";
        lines.push(`${name} waved at you 👋`);
      }
      for (const c of activeCircles) {
        if (c.completedAt) continue; // archived — no more daily headcount
        const checkedIn = checkedInByCircle.get(c.id)?.size ?? 0;
        const total = memberCountByCircle.get(c.id) ?? 0;
        if (total > 0) lines.push(`${checkedIn} of ${total} of ${c.practiceName ?? c.name} showed up today`);
      }
      if ((wallCount ?? 0) > 0) {
        lines.push(`${wallCount} new message${wallCount === 1 ? "" : "s"} on the wall`);
      }

      const shown = lines.slice(0, 4);
      const remaining = lines.length - shown.length;
      const hasCoveredOrWaveLine = (covered?.length ?? 0) > 0 || (waves?.length ?? 0) > 0;
      const image = hasCoveredOrWaveLine
        ? `<p><img src="${COVER_A_FRIEND_IMAGE_URL}" alt="" width="160" style="display:block;margin:0 auto 12px;" /></p>`
        : "";
      const html = `${image}<ul>${shown.map((l) => `<li>${l}</li>`).join("")}</ul>${
        remaining > 0 ? `<p>+ ${remaining} more moment${remaining === 1 ? "" : "s"} waiting</p>` : ""
      }<p><a href="https://rally21.vercel.app">open Rally21</a></p>`;

      const { error: insertError } = await admin.from("notification_outbox").insert({
        user_id: user.id,
        kind: "social_digest",
        payload: { subject: "a few moments in your circle today 💛", html, local_date: localDate },
        scheduled_for: now.toISOString(),
        dedupe_key: dedupeKey,
      });

      // A unique-violation just means another run already enqueued
      // today's digest for this user — the dedupe key doing its job.
      if (insertError && insertError.code !== "23505") {
        console.error(`Could not enqueue digest for user ${user.id}:`, insertError.message);
        continue;
      }
      if (!insertError) summary.enqueued++;
    } catch (e) {
      console.error(`Unhandled error composing digest for user ${user.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
});
