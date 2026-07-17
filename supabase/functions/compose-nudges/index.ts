import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { computeSmartSendTime, hhmmToMinutes } from "./timing.ts";
import {
  LOVED_LINE_MIN_LIKES,
  composeLovedNudge,
  isLovedLineDay,
  reconstructStartDate,
  renderNudge,
  selectNudgeLine,
  shiftDate,
} from "./nudge-lines.ts";

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

// NQ1 (16 July) — the line pools, the deterministic no-repeat window, and
// Cat's notification template all live in ./nudge-lines.ts (pure, so the
// Jest suite unit-tests them and pins the pools byte-identical to
// constants/strings.ts). This file no longer keeps its own line arrays.

// RS1 (13 July) — the one warm rejoin email, after 14+ quiet days in a
// still-ongoing circle. Kept in sync by hand with lib/resting.ts's
// REJOIN_EMAIL_QUIET_DAYS_THRESHOLD (that file can't be imported here).
const REJOIN_EMAIL_QUIET_DAYS_THRESHOLD = 14;
// Same mascot as the client's own welcome-back.tsx (the-restart.png,
// "no streak lost, no guilt" reentry framing) — the one existing email
// image placement precedent is compose-digest's cover-a-friend.png, same
// hosting pattern (the Vercel-exported web asset's own hashed URL).
const THE_RESTART_IMAGE_URL =
  "https://rally21.vercel.app/assets/assets/mascot/the-restart.f3720755916ad298942cb4161aadf321.png";

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

/** Calendar days between two YYYY-MM-DD strings — mirrors lib/date.ts's
 * daysBetween exactly (own copy, this Deno file has no access to the
 * client's module graph). */
function daysBetween(fromLocalDate: string, toLocalDate: string): number {
  const [fy, fm, fd] = fromLocalDate.split("-").map(Number);
  const [ty, tm, td] = toLocalDate.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
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
    skippedNoCircles: 0,
    skippedQuietHours: 0,
    notYetDue: 0,
    rejoinEnqueued: 0,
    skippedAway: 0,
  };

  const { data: candidates, error: candidatesError } = await admin
    .from("users")
    .select("id, timezone, away_since, notification_prefs!inner(nudge_enabled, nudge_time, quiet_start, quiet_end)")
    .eq("notification_prefs.nudge_enabled", true)
    .not("timezone", "is", null);

  if (candidatesError) {
    console.error("Could not load nudge candidates:", candidatesError.message);
    return new Response(JSON.stringify({ error: candidatesError.message }), { status: 500 });
  }

  for (const user of candidates ?? []) {
    summary.candidates++;
    try {
      // RS2 (Rally21-Glow-Spec.md §9) — away is a total pause: no daily
      // nudge, no ember nudge, at compose time. send-notifications also
      // re-guards this at send time (belt-and-braces, same as every other
      // staleness recheck in this pipeline).
      if (user.away_since) {
        summary.skippedAway++;
        continue;
      }

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

      const localDate = localDateString(now, timeZone);
      const dedupeKey = `nudge-${user.id}-${localDate}`;

      // NS1 (13 July): if a circle-mate already waved at this user today,
      // the app's own daily nudge (whichever flavor it would have been —
      // ember included, since both are "the one automated nudge for
      // today") would just be a redundant second poke. send_friend_nudge
      // always writes a notification_outbox row the moment it runs
      // (kind='friend_nudge', payload.local_date), regardless of whether
      // that row later actually sends — so its mere existence for today
      // is the correct, durable signal to check, not send-notifications'
      // own delivered_in_app suppression (that's a separate, send-time
      // decision about the WAVE's own email). Recording a real
      // (immediately-suppressed) nudge_daily row here — same pattern as
      // every other suppression reason elsewhere in this pipeline — both
      // makes this decision auditable and stops this same user from
      // being re-evaluated on every later 15-min tick today (the unique
      // dedupe_key constraint takes over from there).
      const { count: friendNudgeReceivedToday } = await admin
        .from("notification_outbox")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("kind", "friend_nudge")
        .eq("payload->>local_date", localDate);

      if ((friendNudgeReceivedToday ?? 0) > 0) {
        const { error: suppressInsertError } = await admin.from("notification_outbox").insert({
          user_id: user.id,
          kind: "nudge_daily",
          payload: { local_date: localDate },
          scheduled_for: now.toISOString(),
          sent_at: now.toISOString(),
          suppressed_reason: "suppressed_friend_nudge_already",
          dedupe_key: dedupeKey,
        });
        if (suppressInsertError && suppressInsertError.code !== "23505") {
          console.error(`Could not record friend-nudge suppression for user ${user.id}:`, suppressInsertError.message);
        }
        continue;
      }

      // NS1: learn this user's typical check-in time-of-day (their own
      // local tz) from recent completions across every circle — a robust
      // median, not mean, over the last ~21 days. Below the minimum
      // sample size, computeSmartSendTime itself falls back to exactly
      // today's existing default (untouched, unjittered).
      const lookbackCutoff = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentCompletions } = await admin
        .from("completions")
        .select("created_at")
        .eq("user_id", user.id)
        .gte("created_at", lookbackCutoff);
      const timeOfDaySamplesMinutes = (recentCompletions ?? []).map((c: any) =>
        hhmmToMinutes(localTimeString(new Date(c.created_at), timeZone))
      );
      const smartSendTime = computeSmartSendTime({
        timeOfDaySamplesMinutes,
        fallbackTime: prefs.nudge_time ?? activeCircles[0].timeOfDay!,
        userId: user.id,
        localDate,
      });

      // Ember nudge (Rally21-Glow-Spec.md §2, §6) — ships LAST,
      // deliberately, as the one warm notification for the mechanic.
      // Rides this same composer/pref (nudge_enabled) and IS the daily
      // nudge for an ember day — enqueueing it skips nudge_daily below,
      // never both. dedupe_key is keyed on the missed local date (the
      // ember EVENT), not today's date, so re-evaluating every 15 min
      // while still in embers never produces a second row.
      const { data: glowRow } = await admin.rpc("get_glow_for_user", { p_user: user.id });
      const glow = Array.isArray(glowRow) ? glowRow[0] : glowRow;
      if (glow?.state === "embers" && glow.missed_local_date) {
        const emberDedupeKey = `ember-${user.id}-${glow.missed_local_date}`;
        const emberResolved = resolveSendTime(smartSendTime, prefs.quiet_start, prefs.quiet_end);
        if (emberResolved !== "skip") {
          const emberLocalTime = localTimeString(now, timeZone);
          if (emberLocalTime >= emberResolved) {
            const emberHtml = `<p>your glow is down to embers — one small thing today rekindles it.</p>
<p>it's protecting ${glow.glow} day${glow.glow === 1 ? "" : "s"} of showing up.</p>
<p><a href="https://rally21.vercel.app">open Rally21</a></p>`;

            const { error: emberInsertError } = await admin.from("notification_outbox").insert({
              user_id: user.id,
              kind: "ember_nudge",
              payload: {
                subject: "your glow is down to embers 🕯️",
                html: emberHtml,
                local_date: localDateString(now, timeZone),
              },
              scheduled_for: now.toISOString(),
              dedupe_key: emberDedupeKey,
            });

            if (emberInsertError && emberInsertError.code !== "23505") {
              console.error(`Could not enqueue ember nudge for user ${user.id}:`, emberInsertError.message);
            } else if (!emberInsertError) {
              summary.enqueued++;
            }
          }
        }
        continue; // never also enqueue nudge_daily for an ember day
      }

      const resolved = resolveSendTime(smartSendTime, prefs.quiet_start, prefs.quiet_end);
      if (resolved === "skip") {
        summary.skippedQuietHours++;
        continue;
      }

      const localTime = localTimeString(now, timeZone);
      if (localTime < resolved) {
        summary.notYetDue++;
        continue;
      }

      const practiceNames = activeCircles.map((c) => c.practiceName ?? 'your practice');

      // NQ1 (job 2/3): the warm/restart branch AND the no-repeat window are
      // both decided by selectNudgeLine from the user's completion DATES —
      // one query over the reconstruction span, no stored nudge history. The
      // window reconstructs prior sent lines deterministically (anchored at
      // a fixed epoch), so a line never repeats close enough to feel canned.
      // Fetch one day before the reconstruction start so its own
      // missed-yesterday branch can be derived.
      const lookbackStart = shiftDate(reconstructStartDate(localDate), -1);
      const { data: lookbackCompletions } = await admin
        .from("completions")
        .select("local_date")
        .eq("user_id", user.id)
        .gte("local_date", lookbackStart);
      const completedDates = new Set((lookbackCompletions ?? []).map((c: any) => c.local_date as string));
      const { line, branch } = selectNudgeLine({ userId: user.id, localDate, completedDates });

      // NQ2 (17 July) — "a line you loved": on a deterministic roughly-weekly
      // day, the warm-line slot serves back a share-card quote this user
      // Liked instead. Same slot, same row, same timing — never a new
      // notification. The extra reads only happen on a loved-line day for a
      // warm-branch user (~12% of users per day); everyone else costs
      // nothing. Likes are card_events 'liked' rows (the share-card screen's
      // Like control); a flavor the user muted after liking never comes back
      // (user_card_prefs.muted_flavors, flavor-level — same granularity the
      // mute itself has). The gate/pick/length rules live in
      // composeLovedNudge (pure, unit-tested); a null anywhere falls back to
      // NQ1's plain pool for the day.
      let nudgeLine = line;
      if (branch === "warm" && isLovedLineDay(user.id, localDate)) {
        const { data: cardPrefs } = await admin
          .from("user_card_prefs")
          .select("muted_flavors")
          .eq("user_id", user.id)
          .maybeSingle();
        const mutedFlavors = new Set<string>((cardPrefs?.muted_flavors as string[] | undefined) ?? []);

        const { data: likeRows } = await admin
          .from("card_events")
          .select("card_key, flavor")
          .eq("user_id", user.id)
          .eq("event", "liked");
        const likedKeys = [
          ...new Set(
            (likeRows ?? [])
              .filter((r: any) => !mutedFlavors.has(r.flavor as string))
              .map((r: any) => r.card_key as string)
          ),
        ];

        // Cheap pre-gate before the bank join — eligibility inside
        // composeLovedNudge only ever shrinks this set, never grows it.
        if (likedKeys.length >= LOVED_LINE_MIN_LIKES) {
          const { data: bankRows } = await admin
            .from("share_card_bank")
            .select("id, body, attribution, tier")
            .in("id", likedKeys)
            .eq("active", true);
          const loved = composeLovedNudge({
            userId: user.id,
            localDate,
            branch,
            likedQuotes: (bankRows ?? []).map((b: any) => ({
              cardKey: b.id as string,
              body: b.body as string,
              attribution: (b.attribution as string | null) ?? null,
              tier: b.tier as string,
            })),
            practiceNames,
          });
          if (loved) nudgeLine = loved.line;
        }
      }

      // NQ1 (job 4): Cat's exact template — one subject, a push body the
      // sender delivers verbatim, and the email html. No "with your circle".
      // A loved-line day writes the fully rendered loved line (prefix +
      // attribution) into push_body the same way, so the push reads
      // title + the loved line.
      const { subject, pushBody, html } = renderNudge(practiceNames, nudgeLine);

      const { error: insertError } = await admin
        .from("notification_outbox")
        .insert({
          user_id: user.id,
          kind: "nudge_daily",
          // local_date lets send-notifications refuse to deliver this once
          // the recipient's calendar date has moved on — a row held by
          // quiet hours overnight must never arrive describing a day that
          // has already passed (see send-notifications' expiry check).
          // push_body is Cat's template body; send-notifications prefers it
          // over stripping the html for the push.
          payload: { subject, html, push_body: pushBody, local_date: localDate },
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

  // RS1 (13 July) — the one warm rejoin email: a member is only ever
  // visually "resting" client-side (never stored), but 14+ quiet days in
  // a still-ongoing circle is real enough to warrant one gentle outreach.
  // Deliberately independent of the per-user loop above — a member can be
  // quiet in circle A while circle B's own daily nudge still fires
  // normally, and this must never skip because that other loop already
  // `continue`d for an unrelated reason (friend-nudge suppression, an
  // ember day, etc.) — so it walks every active membership directly.
  const { data: restingMemberships, error: restingMembershipsError } = await admin
    .from("memberships")
    .select("user_id, circle_id, joined_at, circles!inner(is_active, completed_at)")
    .eq("circles.is_active", true)
    .is("circles.completed_at", null);

  if (restingMembershipsError) {
    console.error("Could not load memberships for the rejoin pass:", restingMembershipsError.message);
  }

  for (const membership of restingMemberships ?? []) {
    try {
      const { data: prefs } = await admin
        .from("notification_prefs")
        .select("nudge_enabled")
        .eq("user_id", membership.user_id)
        .maybeSingle();
      if (!prefs?.nudge_enabled) continue;

      const { data: userRow } = await admin
        .from("users")
        .select("timezone, away_since")
        .eq("id", membership.user_id)
        .maybeSingle();

      // RS2 — an away member is never "resting" either: the rejoin email
      // exists to gently re-invite someone who drifted off unannounced,
      // not someone who deliberately paused. Skip at compose time; a
      // future genuinely-quiet spell after they return gets evaluated
      // fresh against their (by-then-cleared) away_since.
      if (userRow?.away_since) {
        summary.skippedAway++;
        continue;
      }

      const timeZone = (userRow?.timezone as string | null) || "UTC";
      const today = localDateString(now, timeZone);
      const joinedLocalDate = localDateString(new Date(membership.joined_at as string), timeZone);

      // Never born resting (lib/resting.ts's own rule) — skip the
      // completions lookup entirely for a joiner too new to qualify.
      if (daysBetween(joinedLocalDate, today) <= REJOIN_EMAIL_QUIET_DAYS_THRESHOLD) continue;

      const { data: lastCompletionRow } = await admin
        .from("completions")
        .select("local_date")
        .eq("user_id", membership.user_id)
        .eq("circle_id", membership.circle_id)
        .order("local_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastCompletionDate = (lastCompletionRow?.local_date as string | undefined) ?? null;
      const daysSinceLastCompletion = lastCompletionDate
        ? daysBetween(lastCompletionDate, today)
        : Infinity;

      if (daysSinceLastCompletion < REJOIN_EMAIL_QUIET_DAYS_THRESHOLD) continue;

      // The resting SPELL is identified by the last real activity date
      // (or the join date if there's never been one) — it changes the
      // moment they check in again, so a future spell after a real
      // rejoin-then-quiet-again cycle gets its own fresh dedupe key
      // instead of being silently blocked by this one's.
      const spellKey = lastCompletionDate ?? joinedLocalDate;
      const dedupeKey = `rest_rejoin-${membership.user_id}-${membership.circle_id}-${spellKey}`;

      const { data: circleRow } = await admin
        .from("circles")
        .select("name")
        .eq("id", membership.circle_id)
        .maybeSingle();
      const circleName = (circleRow?.name as string | undefined) ?? "your circle";

      const html = `<p><img src="${THE_RESTART_IMAGE_URL}" alt="" width="160" style="display:block;margin:0 auto 12px;" /></p>
<p>the huddle kept your spot warm in ${circleName}.</p>
<p>no streak lost, no catching up required — just today, whenever you're ready.</p>
<p><a href="https://rally21.vercel.app">open Rally21</a></p>`;

      const { error: rejoinInsertError } = await admin.from("notification_outbox").insert({
        user_id: membership.user_id,
        kind: "rest_rejoin",
        payload: {
          subject: "the huddle kept your spot warm 💛",
          html,
          circleId: membership.circle_id,
        },
        scheduled_for: now.toISOString(),
        dedupe_key: dedupeKey,
      });

      // A unique-violation just means this exact spell already got its
      // one email — not an error, exactly the dedupe this key guarantees.
      if (rejoinInsertError && rejoinInsertError.code !== "23505") {
        console.error(
          `Could not enqueue rest_rejoin for user ${membership.user_id} in circle ${membership.circle_id}:`,
          rejoinInsertError.message
        );
      } else if (!rejoinInsertError) {
        summary.rejoinEnqueued++;
      }
    } catch (e) {
      console.error(
        `Unhandled error composing rest_rejoin for user ${membership.user_id}:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
});
