import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  computeSmartSendTime,
  hhmmToMinutes,
  resolveAlarmHeldSendTime,
  resolveSendTime,
} from "./timing.ts";
import { CLIFF_NOTICE_COPY, selectDailyNudgeKind } from "./cliff-notice.ts";
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
  // M2 (17 July): re-hashed for the restyled the-restart art.
  "https://rally21.com/assets/assets/mascot/the-restart.a40d438c1b066b8dca5439a35c5288a8.png";

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

// resolveSendTime MOVED TO ./timing.ts BY CV3, unchanged line for line —
// it had always been pure, but living in this Deno.serve module meant
// Jest could never import it, so the one place quiet hours are decided
// was the one place no test could reach. See its note there.

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
    // AL1 job 3 — the hold's two outcomes, counted so a live invocation
    // says out loud how often a declared time changed what happened.
    alarmDropped: 0,
    alarmHeldPastMidnight: 0,
    // EM1 job 1 — counted separately from `enqueued` so a live
    // invocation says out loud how often an open ember window actually
    // produced an ask, which is the number the window's definition is
    // judged on.
    emberAsksEnqueued: 0,
    // CV3 — same reasoning, for the person's own half. Five cliffs have
    // happened in the project's life, so this number staying at 0 for a
    // long stretch is expected rather than evidence of a fault.
    cliffNoticesEnqueued: 0,
  };

  const { data: candidates, error: candidatesError } = await admin
    .from("users")
    // AL1 job 3 — alarm_enabled/alarm_time ride along so the hold below
    // costs no extra query per user.
    .select("id, timezone, away_since, alarm_enabled, alarm_time, notification_prefs!inner(nudge_enabled, nudge_time, quiet_start, quiet_end)")
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
        // CH5: ON CONFLICT DO NOTHING at the database (ignoreDuplicates)
        // — the old plain INSERT still raised a 23505 ERROR into the
        // Postgres log on every later 15-min tick even though the client
        // tolerated it; the dedupe is expected behavior, not an error.
        const { error: suppressInsertError } = await admin.from("notification_outbox").upsert(
          {
            user_id: user.id,
            kind: "nudge_daily",
            payload: { local_date: localDate },
            scheduled_for: now.toISOString(),
            sent_at: now.toISOString(),
            suppressed_reason: "suppressed_friend_nudge_already",
            dedupe_key: dedupeKey,
          },
          { onConflict: "dedupe_key", ignoreDuplicates: true }
        );
        if (suppressInsertError) {
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

      // AL1 job 3 (Cat's ruling, 27 July) — THE HOLD. For someone who has
      // declared a practice time, the local reminder goes first and this
      // nudge becomes the second chance: held until ALARM_NUDGE_HOLD_MINUTES
      // after the declared time, and dropped if a check-in lands in between.
      //
      // WHERE THE HOLD LIVES, said plainly because AL1 asks for it: BOTH,
      // and each half does a different job. Client-side (lib/alarmReminder
      // .ts) is where the reminder itself is scheduled and cancelled, which
      // must work offline. Server-side is HERE, in the composer, because
      // the nudge is a server decision and gating it at compose time means
      // no row is written until the hold has expired — nothing sits in the
      // outbox waiting to be suppressed, and the existing
      // dedupe_key/notYetDue machinery carries the delay for free. The two
      // halves never talk to each other; both read users.alarm_time.
      //
      // THE DROP, expressed here rather than left to send-notifications'
      // own already-checked-in guard: for an alarm-enabled person a
      // completion today means the reminder did its job, so the day's nudge
      // is recorded as suppressed and this user stops being re-evaluated on
      // every later 15-min tick — the same auditable-suppression pattern the
      // friend-nudge branch above uses. send-notifications still re-checks
      // at send time for everyone; this is compose-time, and additional.
      const alarmEnabled = user.alarm_enabled === true;
      const alarmTime = user.alarm_time as string | null;
      let dueTime = smartSendTime;

      if (alarmEnabled && alarmTime) {
        const { count: completionsToday } = await admin
          .from("completions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("local_date", localDate);

        if ((completionsToday ?? 0) > 0) {
          const { error: dropInsertError } = await admin.from("notification_outbox").upsert(
            {
              user_id: user.id,
              kind: "nudge_daily",
              payload: { local_date: localDate },
              scheduled_for: now.toISOString(),
              sent_at: now.toISOString(),
              suppressed_reason: "suppressed_alarm_reminder_worked",
              dedupe_key: dedupeKey,
            },
            { onConflict: "dedupe_key", ignoreDuplicates: true }
          );
          if (dropInsertError) {
            console.error(`Could not record alarm-reminder drop for user ${user.id}:`, dropInsertError.message);
          }
          summary.alarmDropped++;
          continue;
        }

        const held = resolveAlarmHeldSendTime({ smartSendTime, alarmEnabled, alarmTime });
        if (held === "held_past_midnight") {
          // A declared time late enough that its second chance would land
          // tomorrow gets no nudge today. Nothing is written: tomorrow's
          // tick composes tomorrow's nudge from scratch.
          summary.alarmHeldPastMidnight++;
          continue;
        }
        dueTime = held;
      }

      // Ember nudge (Rally21-Glow-Spec.md §2, §6) — ships LAST,
      // deliberately, as the one warm notification for the mechanic.
      // Rides this same composer/pref (nudge_enabled) and IS the daily
      // nudge for an ember day — enqueueing it skips nudge_daily below,
      // never both. dedupe_key is keyed on the missed local date (the
      // ember EVENT), not today's date, so re-evaluating every 15 min
      // while still in embers never produces a second row.
      const { data: glowRow } = await admin.rpc("get_glow_for_user", { p_user: user.id });
      const glow = Array.isArray(glowRow) ? glowRow[0] : glowRow;

      // CV3 (23 Aug) — THE PERSON'S OWN CLIFF NOTICE. Cat's ruling of 16
      // Aug was that the friends hear AND the person hears; CV2 shipped
      // the friends' half. This is the other half, and it exists because
      // the ember ask structurally cannot reach a SOLO member.
      //
      // The window is decided in ONE place, public.cliff_window_for(),
      // which is itself a filter over CV2's ember_window_for rather than
      // a second derivation — so this notice can never claim a cliff on
      // a morning the circle screen would still offer a cover for. Every
      // suppression (a cover or away day on the missed date, their own
      // check-in this morning, a run that already broke unsheltered)
      // lives in that function with its argument, and is tested there.
      const { data: cliffRows, error: cliffError } = await admin.rpc("cliff_window_for", {
        p_user: user.id,
      });
      if (cliffError) {
        // FF1: a failed read here decides whether to send someone a
        // notification about their own glow. Fail CLOSED and say so —
        // the conservative direction — rather than substituting "no
        // window" silently and calling it a decision.
        console.error(`Could not read the cliff window for user ${user.id}:`, cliffError.message);
      }
      const cliff = Array.isArray(cliffRows) ? cliffRows[0] : cliffRows;

      // EM0's never-both rule, now with three competitors instead of
      // two. Decided in one pure function so it can be tested at all —
      // see ./cliff-notice.ts.
      const todaysKind = selectDailyNudgeKind({
        cliffWindowOpen: !cliffError && !!cliff?.missed_local_date,
        glowState: glow?.state,
        emberMissedLocalDate: glow?.missed_local_date,
      });

      if (todaysKind === "cliff_notice") {
        // EM1's dedupe pattern: keyed on the MISSED date (the event),
        // never today's, so re-evaluating every 15 minutes produces one
        // row and one only.
        const cliffDedupeKey = `cliff-${user.id}-${cliff.missed_local_date}`;
        // dueTime, not smartSendTime: this IS the daily nudge today, so
        // AL1's hold governs it exactly as it governs the ember nudge —
        // a declared practice time must not be honoured on ordinary days
        // and ignored on the one day that decides the run.
        const cliffResolved = resolveSendTime(dueTime, prefs.quiet_start, prefs.quiet_end);
        if (cliffResolved !== "skip") {
          const cliffLocalTime = localTimeString(now, timeZone);
          if (cliffLocalTime >= cliffResolved) {
            const { data: cliffInserted, error: cliffInsertError } = await admin
              .from("notification_outbox")
              .upsert(
                {
                  user_id: user.id,
                  kind: "cliff_notice",
                  payload: {
                    // Cat's ruled copy, 23 Aug — candidate C, verbatim on
                    // all three surfaces. push_body is carried explicitly
                    // so the lock screen gets her exact line rather than
                    // stripped html (NQ1's pattern, which
                    // send-notifications prefers when a composer supplies
                    // one).
                    subject: CLIFF_NOTICE_COPY.subject,
                    html: CLIFF_NOTICE_COPY.html,
                    push_body: CLIFF_NOTICE_COPY.pushBody,
                    local_date: localDate,
                    missed_local_date: cliff.missed_local_date,
                    spell_day: cliff.spell_day,
                    // CV3 job R (Cat's ruling, 23 Aug, from CV2 job 6(a)'s
                    // diagnosability find) — the timezone COMPOSE used,
                    // stamped so a row can be read back afterwards
                    // without guessing which zone dated it. No read path
                    // consumes this; it is a diagnostic.
                    compose_tz: timeZone,
                  },
                  scheduled_for: now.toISOString(),
                  dedupe_key: cliffDedupeKey,
                },
                { onConflict: "dedupe_key", ignoreDuplicates: true }
              )
              .select("id");

            if (cliffInsertError) {
              console.error(
                `Could not enqueue cliff notice for user ${user.id}:`,
                cliffInsertError.message
              );
            } else if ((cliffInserted ?? []).length > 0) {
              summary.cliffNoticesEnqueued++;
            }
          }
        }
        continue; // never also enqueue an ember nudge or nudge_daily today
      }

      if (todaysKind === "ember_nudge") {
        const emberDedupeKey = `ember-${user.id}-${glow.missed_local_date}`;
        // dueTime, not smartSendTime: the ember nudge IS the daily nudge on
        // an ember day (it rides the same pref and never sends alongside
        // one), so AL1's hold has to govern it too — otherwise a declared
        // time would be honoured on ordinary days and quietly ignored on
        // exactly the days that matter most.
        const emberResolved = resolveSendTime(dueTime, prefs.quiet_start, prefs.quiet_end);
        if (emberResolved !== "skip") {
          const emberLocalTime = localTimeString(now, timeZone);
          if (emberLocalTime >= emberResolved) {
            const emberHtml = `<p>your glow is down to embers — one small thing today rekindles it.</p>
<p>it's protecting ${glow.glow} day${glow.glow === 1 ? "" : "s"} of showing up.</p>
<p><a href="https://rally21.com">open Rally21</a></p>`;

            // CH5: DO NOTHING on the dedupe key — no more 23505 ERROR
            // noise in the Postgres log; .select() returns only really-
            // inserted rows so the enqueued count stays honest.
            const { data: emberInserted, error: emberInsertError } = await admin
              .from("notification_outbox")
              .upsert(
                {
                  user_id: user.id,
                  kind: "ember_nudge",
                  payload: {
                    subject: "your glow is down to embers 🕯️",
                    html: emberHtml,
                    local_date: localDateString(now, timeZone),
                  },
                  scheduled_for: now.toISOString(),
                  dedupe_key: emberDedupeKey,
                },
                { onConflict: "dedupe_key", ignoreDuplicates: true }
              )
              .select("id");

            if (emberInsertError) {
              console.error(`Could not enqueue ember nudge for user ${user.id}:`, emberInsertError.message);
            } else if ((emberInserted ?? []).length > 0) {
              summary.enqueued++;
            }
          }
        }
        continue; // never also enqueue nudge_daily for an ember day
      }

      const resolved = resolveSendTime(dueTime, prefs.quiet_start, prefs.quiet_end);
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

        // SC2: quotes ONLY — a Liked warm_journey card is a liked
        // TEMPLATE (raw {slot} text, no tier) and a liked dot_strip has
        // no bank row at all; neither may reach "a line you loved". The
        // flavor filter also keeps the 3-distinct-likes gate counting
        // liked QUOTES, which is what the NQ2 floor meant.
        const { data: likeRows } = await admin
          .from("card_events")
          .select("card_key, flavor")
          .eq("user_id", user.id)
          .eq("event", "liked")
          .eq("flavor", "curated_quote");
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
            .eq("active", true)
            .eq("flavor", "curated_quote");
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

      // CH5: DO NOTHING on the dedupe key at the database — the old
      // plain INSERT raised a 23505 ERROR into the Postgres log on every
      // 15-min tick after the first (the recorded ERROR bursts), even
      // though the client treated it as expected. .select() returns only
      // really-inserted rows, so enqueued still counts real enqueues.
      const { data: inserted, error: insertError } = await admin
        .from("notification_outbox")
        .upsert(
          {
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
          },
          { onConflict: "dedupe_key", ignoreDuplicates: true }
        )
        .select("id");

      if (insertError) {
        console.error(`Could not enqueue nudge for user ${user.id}:`, insertError.message);
        continue;
      }
      if ((inserted ?? []).length > 0) summary.enqueued++;
    } catch (e) {
      console.error(`Unhandled error composing nudge for user ${user.id}:`, e instanceof Error ? e.message : e);
    }
  }

  // EM1 job 1 (9 Aug) — THE EMBER ASK. A separate pass, not part of the
  // per-user loop above, because it is driven by somebody ELSE's open
  // window rather than by the asked person's own nudge schedule — and it
  // must not be skipped just because that loop already `continue`d for
  // an unrelated reason (an ember day of their own, a wave they
  // received, an alarm hold).
  //
  // WHAT THIS PASS DOES AND DOES NOT DECIDE. It enqueues; it does not
  // send. The 2-A-DAY PROMISE HOLDS ABSOLUTELY — the ask goes through
  // send-notifications' one generic cap and its one quiet-hours clamp
  // exactly like every other kind, riding inside them rather than beside
  // them, and it carries no send-time logic of its own here. It is also
  // enqueued with scheduled_for = now() rather than at a computed hour:
  // NS1's smart send time exists to learn the recipient's OWN practice
  // rhythm, which has nothing to do with when a friend's window opened,
  // and the quiet-hours hold at send time already keeps it out of the
  // night.
  //
  // The window itself — who is missing what day, and whether Cat's
  // two-day cadence still allows an ask — is decided in ONE place,
  // public.find_open_ember_windows(), so the notification can never
  // offer a rescue the circle screen would not. See that migration.
  type EmberWindow = {
    asked_user_id: string;
    asked_user_timezone: string | null;
    missed_user_id: string;
    missed_user_name: string;
    circle_id: string;
    circle_name: string;
    missed_local_date: string;
    spell_day: number;
  };

  const { data: emberWindows, error: emberWindowsError } = await admin.rpc("find_open_ember_windows");
  if (emberWindowsError) {
    console.error("Could not load open ember windows:", emberWindowsError.message);
  }

  for (const w of (emberWindows ?? []) as EmberWindow[]) {
    try {
      const askedTimeZone = w.asked_user_timezone || "UTC";
      // ONE ask per asked person per window, whatever the circle count:
      // two people who share two circles with the same missed member are
      // one poke, not two. The key deliberately omits the circle — the
      // glow being rescued is personal, not per-circle, so a second ask
      // would be the same request wearing a different circle's name.
      const dedupeKey = `ember_ask-${w.asked_user_id}-${w.missed_user_id}-${w.missed_local_date}`;

      // CH5: DO NOTHING on the dedupe key — this function re-evaluates
      // every window every 15 minutes for as long as it stays open, so
      // the collision is the design and not a 23505 to log.
      const { data: askInserted, error: askInsertError } = await admin
        .from("notification_outbox")
        .upsert(
          {
            user_id: w.asked_user_id,
            kind: "ember_ask",
            payload: {
              missedUserId: w.missed_user_id,
              missedName: w.missed_user_name,
              circleId: w.circle_id,
              circleName: w.circle_name,
              missed_local_date: w.missed_local_date,
              spell_day: w.spell_day,
              // The ASKED person's own local date, so the generic
              // staleness guard in send-notifications expires a row held
              // by quiet hours across their midnight: by then the window
              // has moved on and tomorrow's tick composes a fresh ask if
              // one is still owed.
              local_date: localDateString(now, askedTimeZone),
              // CV3 job R (Cat's ruling, 23 Aug, from CV2 job 6(a)'s
              // diagnosability find) — the timezone COMPOSE used to date
              // the line above, stamped so a row can be read back
              // afterwards without guessing. This is the ASKED person's
              // zone (or 'UTC' where they have none), which is the one
              // that dated local_date and therefore the one that governs
              // when this row goes stale. No read path consumes it.
              compose_tz: askedTimeZone,
            },
            scheduled_for: now.toISOString(),
            dedupe_key: dedupeKey,
          },
          { onConflict: "dedupe_key", ignoreDuplicates: true }
        )
        .select("id");

      if (askInsertError) {
        console.error(
          `Could not enqueue ember ask for user ${w.asked_user_id}:`,
          askInsertError.message
        );
      } else if ((askInserted ?? []).length > 0) {
        summary.emberAsksEnqueued++;
      }
    } catch (e) {
      console.error(
        `Unhandled error composing ember ask for user ${w.asked_user_id}:`,
        e instanceof Error ? e.message : e
      );
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
<p><a href="https://rally21.com">open Rally21</a></p>`;

      // CH5: DO NOTHING on the dedupe key — the dedupe is the design,
      // never a Postgres ERROR log line; .select() keeps the count real.
      const { data: rejoinInserted, error: rejoinInsertError } = await admin
        .from("notification_outbox")
        .upsert(
          {
            user_id: membership.user_id,
            kind: "rest_rejoin",
            payload: {
              subject: "the huddle kept your spot warm 💛",
              html,
              circleId: membership.circle_id,
            },
            scheduled_for: now.toISOString(),
            dedupe_key: dedupeKey,
          },
          { onConflict: "dedupe_key", ignoreDuplicates: true }
        )
        .select("id");

      if (rejoinInsertError) {
        console.error(
          `Could not enqueue rest_rejoin for user ${membership.user_id} in circle ${membership.circle_id}:`,
          rejoinInsertError.message
        );
      } else if ((rejoinInserted ?? []).length > 0) {
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
