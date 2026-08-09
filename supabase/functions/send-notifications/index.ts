import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// The scheduled sender (spec §2/§5): pg_cron invokes this every 15 min via
// net.http_post with a shared secret header (not a user JWT, so this
// function has verify_jwt=false and authenticates the caller itself). The
// secret is read from Supabase Vault via a service-role-only RPC rather
// than a separately-configured Deno env var — one source of truth, no
// manual transcription step to get wrong. It claims every due,
// unprocessed outbox row and re-applies suppression at send time — quiet
// hours, the per-kind pref toggle, and the content check ("already
// checked in" / "no active circles" / "already seen it") — because a row
// can sit queued for a while and any of those can have changed since it
// was enqueued. Composers (nudge/digest/friend-nudge, built in Parts B/C)
// decide WHAT to say; this function only decides WHETHER and HOW to send
// it, so the channel (email now, push later) is the only thing that ever
// changes here.
//
// A row's payload is usually `{ subject: string, html: string }` — fully
// rendered by whichever composer created it, and this function doesn't
// build copy itself. The one exception (security spec S1, F4):
// friend_nudge rows carry `senderName`/`circleName` instead, since
// send_friend_nudge must never accept client-composed email content —
// this function composes that one kind's subject/html itself, right
// before sending.
//
// PN1 (13 July): push is a new delivery channel on this SAME outbox row,
// never a parallel system. If the recipient has a live device token, the
// already-composed subject/html is delivered as a push instead of an
// email (anti-pile-on — never both for one row); everyone else keeps
// getting email exactly as before. Scope simplification, documented in
// DEFERRED.md: only the user's single most-recently-seen device_tokens
// row is used (most users have exactly one), since the outbox row's
// bookkeeping columns (push_ticket_id/push_token) hold one value, not a
// per-device array.

type PrefRow = {
  nudge_enabled: boolean;
  digest_enabled: boolean;
  friend_nudge_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
};

type OutboxRow = {
  id: string;
  user_id: string;
  kind:
    | "nudge_daily"
    | "social_digest"
    | "friend_nudge"
    | "ember_nudge"
    | "rest_rejoin"
    // EM1 (9 Aug) — the two outbound halves of the ember mechanic. Both
    // carry NAMES and ids only; their copy is composed here from fixed
    // templates, the friend_nudge shape (security spec S1, F4).
    | "ember_ask"
    | "covered_notice";
  payload: {
    subject?: string;
    html?: string;
    // NQ1 (16 July): nudge_daily rows carry Cat's exact template body for
    // the push, so the push isn't a stripped-html approximation. Every
    // other kind (and older queued rows) omits it and falls back to
    // stripHtmlToPushBody unchanged.
    push_body?: string;
    local_date?: string;
    senderName?: string;
    circleName?: string;
    // RS1 — rest_rejoin only, so the send-time staleness recheck below
    // knows which circle to re-verify the member is still resting in.
    circleId?: string;
    // EM1 — ember_ask: who is being rescued, and the day a cover would
    // rescue. Both are re-read at send time (the window can close while
    // the row waits) and both ride into the push payload so a tap opens
    // CV1's cover flow on the right person and the right day.
    missedUserId?: string;
    missedName?: string;
    missed_local_date?: string;
    spell_day?: number;
    // EM1 — covered_notice: who did the covering.
    covererId?: string;
    covererName?: string;
  };
  scheduled_for: string;
};

// Security spec S1 (F4): send_friend_nudge no longer accepts client-composed
// subject/HTML — the RPC only writes senderName/circleName, and THIS
// function composes the email now (the one exception to "composers decide
// WHAT to say" — the spec is explicit that this is where it belongs, since
// the RPC must never trust caller-supplied email content). Own literal
// copy of the warm-line pool, same convention as compose-nudges'
// NUDGE_WARM_LINES (this Deno file has no access to the client's module
// graph) — keep in sync with constants/strings.ts's history if it's ever
// touched there again.
const FRIEND_NUDGE_MESSAGES = [
  "thinking of you today 💛",
  "the circle's warmer with you",
  "no pressure — just waving",
  "sending a little sunshine your way ☀️",
  "just popped by to say hi 👋",
];

function composeFriendNudgeEmail(senderName: string): { subject: string; html: string } {
  const message = FRIEND_NUDGE_MESSAGES[Math.floor(Math.random() * FRIEND_NUDGE_MESSAGES.length)];
  return {
    subject: `${senderName} is waving at you 👋`,
    html: `<p>${senderName}: "${message}"</p>`,
  };
}

/** A person's own name reaches an email BODY here, so it is escaped
 * rather than interpolated raw. (The older friend_nudge template above
 * predates this and is deliberately left as it is — EM1 does not widen
 * its scope to rewrite it, but it does not add a second one either.)
 *
 * Only the html is escaped, never the subject or the push body: those
 * two are plain-text fields (Resend's `subject`, Expo's `title`), where
 * an escaped ampersand would arrive on someone's lock screen reading
 * "Ben &amp; Co" — the escaping would be the bug. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// EM1 (9 Aug) — BOTH of the mechanic's notifications are composed here,
// server-side, from fixed templates: the ask's row carries only the
// missed member's looked-up NAME, the notice's only the coverer's, and
// nothing client-composed ever crosses into either (the send_friend_nudge
// precedent, security spec S1 F4).
//
// HOUSE LAWS, restated because this is the app's first proactive
// friend-nudge. The ask is a care-framed RESCUE — it never says anyone
// is failing, never counts anything, and never implies a debt; "a gift,
// never a debt" is the shipped cover-flow register (constants/strings.ts)
// and this copy stays inside it. The notice is warmth — it never says
// "you missed", and its reassurance is the already-approved
// circleCoveredYouCardBody verbatim. Both render IN FULL on a lock
// screen, so neither may carry anything the person named would mind a
// stranger reading over their shoulder: the ask says someone has been
// quiet, never that they have failed, and no practice name appears in
// either. No pronouns beyond "them" — there is no gender data in this
// app (CLAUDE.md's cover-a-friend rule).
function composeEmberAsk(missedName: string): {
  subject: string;
  html: string;
  pushBody: string;
} {
  const name = escapeHtml(missedName);
  return {
    subject: `${missedName}'s been quiet`,
    pushBody: "yesterday's still open — you could cover it 🧡",
    html: `<p>${name}'s been quiet, and yesterday is still open.</p>
<p>you can log the day for them — a gift, never a debt 🧡</p>
<p><a href="https://rally21.com">open Rally21</a></p>`,
  };
}

function composeCoveredNotice(covererName: string): {
  subject: string;
  html: string;
  pushBody: string;
} {
  const name = escapeHtml(covererName);
  // Cat's words, 9 Aug, in session: "{name}'s got your back" over
  // "Today is a new day, keep on rallying!". Quoted here because the
  // house law is that this copy is HERS — a future session editing it
  // for register (every other notification is lowercase sentence case;
  // this one deliberately is not) needs her, not a style rule.
  return {
    subject: `${covererName}'s got your back 🧡`,
    pushBody: 'Today is a new day, keep on rallying!',
    html: `<p>${name} covered you for yesterday 🧡</p>
<p>Today is a new day, keep on rallying!</p>
<p><a href="https://rally21.com">open Rally21</a></p>`,
  };
}

const KIND_TO_PREF_COLUMN: Record<OutboxRow["kind"], keyof PrefRow> = {
  nudge_daily: "nudge_enabled",
  social_digest: "digest_enabled",
  friend_nudge: "friend_nudge_enabled",
  // The ember nudge rides the same pref — it IS the daily nudge for an
  // ember day (Rally21-Glow-Spec.md §6).
  ember_nudge: "nudge_enabled",
  // RS1 — the rejoin email is fundamentally an invitation nudge (no
  // dedicated pref exists, or is warranted, for this one rare email).
  rest_rejoin: "nudge_enabled",
  // EM1 — REPORTED FOR CAT'S RULING, and this is the whole of the
  // decision in one place. Both halves ride friend_nudge_enabled, the
  // app's only peer-to-peer category: everything under it is warmth
  // BETWEEN circle-mates rather than a reminder about your own practice,
  // which is exactly what the ask and the notice are. The mismatch worth
  // knowing about is the settings HELPER, which today describes waves
  // specifically ("let someone in your circle send you a quiet wave…"),
  // so a person who turned that off to stop being poked is also, now,
  // opting out of being ASKED to help — a defensible reading of the same
  // switch, but not one they were told about. A dedicated
  // `ember_ask_enabled` column plus its own settings row is the
  // alternative; it is a new pref, so it is Cat's to rule. Changing this
  // is two lines here and one in unsubscribe/index.ts.
  ember_ask: "friend_nudge_enabled",
  covered_notice: "friend_nudge_enabled",
};

function localDateString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
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

// RS1 — kept in sync by hand with compose-nudges' own copy.
const REJOIN_EMAIL_QUIET_DAYS_THRESHOLD = 14;

function localTimeString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour")!.value;
  const min = parts.find((p) => p.type === "minute")!.value;
  return `${h}:${min}`;
}

/** quiet_start/quiet_end are "HH:MM:SS" from Postgres `time`; a range like
 * 22:00-08:00 wraps midnight. */
function isQuietHours(localTime: string, quietStart: string, quietEnd: string): boolean {
  const start = quietStart.slice(0, 5);
  const end = quietEnd.slice(0, 5);
  if (start === end) return false;
  if (start < end) return localTime >= start && localTime < end;
  return localTime >= start || localTime < end;
}

async function signToken(secret: string, userId: string, kind: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${userId}:${kind}`));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** ≤2 delivered sends/day, total, across every kind (spec §5) — checked
 * generically rather than per-kind, so "nudge takes slot 1, a friend
 * nudge takes slot 2, that evening's digest is skipped" falls out of
 * plain chronological order (the digest fires last, at 19:00) instead of
 * needing hand-written slot logic. Counts only rows that actually sent
 * (suppressed_reason null) — a row this function held back for some
 * other reason never used up a slot. */
async function countDeliveredToday(
  admin: ReturnType<typeof createClient>,
  userId: string,
  timeZone: string,
  now: Date
): Promise<number> {
  const { data } = await admin
    .from("notification_outbox")
    .select("sent_at")
    .eq("user_id", userId)
    .is("suppressed_reason", null)
    .not("sent_at", "is", null)
    .gte("sent_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

  const today = localDateString(now, timeZone);
  return (data ?? []).filter((r: any) => localDateString(new Date(r.sent_at), timeZone) === today).length;
}

function unsubscribeFooter(supabaseUrl: string, userId: string, kind: string, token: string): string {
  const link = `${supabaseUrl}/functions/v1/unsubscribe?u=${userId}&k=${kind}&t=${token}`;
  return `<hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px" />
<p style="font-size:11px;color:#999;line-height:1.5">
  <a href="${link}" style="color:#999">unsubscribe from these</a> — no hard feelings, your circle still glows 💛
</p>`;
}

/** Push has no HTML rendering — reuse the same composed subject/html by
 * stripping tags/whitespace down to a short plain-text body, rather than
 * having composers produce a second, push-specific copy. */
function stripHtmlToPushBody(html: string, maxLen = 140): string {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

/** One push per outbox row, to the single most-recently-seen device
 * token on file for that user (see the file-header scope note). Returns
 * null if the user has no registered device at all — the caller falls
 * back to email exactly as it does today. */
async function sendExpoPush(
  admin: ReturnType<typeof createClient>,
  userId: string,
  title: string,
  body: string,
  // EM1 job 2 — the tap destination, when the row has one. Expo carries
  // `data` through to the response the app reads back on launch; a row
  // without one behaves exactly as every push did before.
  data?: Record<string, string>
): Promise<{ ticket: ExpoTicket; token: string } | null> {
  const { data: device } = await admin
    .from("device_tokens")
    .select("token")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!device?.token) return null;

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify([{ to: device.token, title, body, sound: "default", ...(data ? { data } : {}) }]),
  });
  const json = await res.json();
  const ticket: ExpoTicket = Array.isArray(json?.data) ? json.data[0] : json?.data;
  return { ticket, token: device.token };
}

/** Receipts sweep (spec step 5): Expo's /send response only confirms
 * hand-off, not real delivery — DeviceNotRegistered typically only shows
 * up in the LATER receipt, once Expo has actually heard back from APNs.
 * Runs once per invocation, before processing new due rows, and only
 * checks tickets old enough (>=1 min) to plausibly have a receipt yet;
 * every checked row is stamped push_receipt_checked_at regardless of
 * outcome so it's never re-checked. Idempotent — safe to run every tick. */
async function sweepPushReceipts(admin: ReturnType<typeof createClient>, now: Date): Promise<number> {
  const { data: rows } = await admin
    .from("notification_outbox")
    .select("id, push_ticket_id, push_token")
    .not("push_ticket_id", "is", null)
    .is("push_receipt_checked_at", null)
    .lte("sent_at", new Date(now.getTime() - 60 * 1000).toISOString());

  if (!rows || rows.length === 0) return 0;

  const ids = rows.map((r: any) => r.push_ticket_id);
  const res = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const json = await res.json();
  const receipts: Record<string, { status: string; details?: { error?: string } }> = json?.data ?? {};

  let pruned = 0;
  for (const row of rows as { id: string; push_ticket_id: string; push_token: string }[]) {
    const receipt = receipts[row.push_ticket_id];
    if (receipt?.status === "error" && receipt.details?.error === "DeviceNotRegistered") {
      await admin.from("device_tokens").delete().eq("token", row.push_token);
      pruned++;
    }
    await admin
      .from("notification_outbox")
      .update({ push_receipt_checked_at: now.toISOString() })
      .eq("id", row.id);
  }
  return pruned;
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: expectedSecret } = await admin.rpc("get_notifications_secret");
  const providedSecret = req.headers.get("x-notifications-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const now = new Date();
  const summary = { processed: 0, sent: 0, suppressed: 0, quietHoursSkipped: 0, failed: 0, pushed: 0, pruned: 0 };

  summary.pruned = await sweepPushReceipts(admin, now).catch((e) => {
    console.error("Push receipt sweep failed:", e instanceof Error ? e.message : e);
    return 0;
  });

  const { data: dueRows, error: dueError } = await admin
    .from("notification_outbox")
    .select("id, user_id, kind, payload, scheduled_for")
    .is("sent_at", null)
    .is("suppressed_reason", null)
    .lte("scheduled_for", now.toISOString());

  if (dueError) {
    console.error("Could not load due outbox rows:", dueError.message);
    return new Response(JSON.stringify({ error: dueError.message }), { status: 500 });
  }

  for (const row of (dueRows ?? []) as OutboxRow[]) {
    summary.processed++;
    try {
      const { data: user } = await admin
        .from("users")
        // AL1 job 3 — the alarm pair rides along for the cap below.
        // EM1 — `name` rides along too, for the ask's deep-link payload.
        .select("name, timezone, last_seen_at, away_since, alarm_enabled, alarm_time")
        .eq("id", row.user_id)
        .single();
      const { data: prefs } = await admin
        .from("notification_prefs")
        .select("nudge_enabled, digest_enabled, friend_nudge_enabled, quiet_start, quiet_end")
        .eq("user_id", row.user_id)
        .single();

      const timeZone = user?.timezone || "UTC";
      const localTime = localTimeString(now, timeZone);

      // RS2 (Rally21-Glow-Spec.md §9) — universal away guard, belt-and-
      // braces with the composers' own compose-time skip: a row can sit
      // queued since before the recipient went away. Every kind is
      // suppressed, no exceptions — a wave's WALL post already happened
      // synchronously when it was sent, so this only ever holds back the
      // email/push half.
      if (user?.away_since) {
        await admin
          .from("notification_outbox")
          .update({ suppressed_reason: "away", sent_at: now.toISOString() })
          .eq("id", row.id);
        summary.suppressed++;
        continue;
      }

      // A row can sit held by quiet hours across a real midnight rollover
      // (e.g. queued at 11:10pm, quiet hours don't end until 8am) — by
      // then the recipient's calendar date has moved on, and content
      // describing "today" would arrive describing yesterday instead.
      // Composers that embed payload.local_date get this staleness guard
      // for free; a row never expires sooner than actually queued, since
      // it's only ever behind "today". Exempt ember_nudge: its window
      // spans TWO calendar days by design (48h from the missed day), so
      // it gets its own dedicated staleness check below instead of this
      // same-day one.
      if (row.payload?.local_date && row.kind !== "ember_nudge") {
        const currentLocalDate = localDateString(now, timeZone);
        if (row.payload.local_date < currentLocalDate) {
          await admin
            .from("notification_outbox")
            .update({ suppressed_reason: "expired", sent_at: now.toISOString() })
            .eq("id", row.id);
          summary.suppressed++;
          continue;
        }
      }

      // Ember nudge staleness guard (Rally21-Glow-Spec.md §6): re-check
      // the glow's CURRENT state at send time, not just at enqueue time —
      // a row can sit queued for a while (quiet hours, cap). Rekindled
      // (checking in resolves the embers) suppresses as
      // 'already_checked_in'; window fully lapsed (cooled to 'cold')
      // suppresses as 'expired'. Only a still-'embers' state actually
      // sends.
      if (row.kind === "ember_nudge") {
        const { data: glowRow } = await admin.rpc("get_glow_for_user", { p_user: row.user_id });
        const glow = Array.isArray(glowRow) ? glowRow[0] : glowRow;
        if (glow?.state !== "embers") {
          await admin
            .from("notification_outbox")
            .update({
              suppressed_reason: glow?.state === "glowing" ? "already_checked_in" : "expired",
              sent_at: now.toISOString(),
            })
            .eq("id", row.id);
          summary.suppressed++;
          continue;
        }
      }

      // EM1 job 1 — THE ASK'S SUPPRESSION, and it is the whole of "a
      // landed cover or the person's own check-in kills every pending ask
      // for that window". It lives here, at send time, for the same
      // reason every other suppression in this pipeline does: a row can
      // sit queued behind quiet hours or the daily cap while the very
      // thing it asks for happens. Nothing is deleted — the row is
      // stamped with its reason, so why an ask never arrived is
      // answerable afterwards.
      //
      // The order matters, because the reasons are not interchangeable and
      // the row keeps whichever one is TRUE. A landed cover is checked
      // first and looks across EVERY circle, not just this ask's: the
      // window itself is per-circle (that is the day a cover would be
      // written against), but somebody rescuing them somewhere else is
      // still a reason not to poke a third person about it.
      //
      // The last check re-asks `ember_window_for` — the same function
      // find_open_ember_windows and the circle screen both use — rather
      // than re-deriving the rule here. A hand-copy at send time is
      // exactly the drift this section's migration exists to remove.
      if (row.kind === "ember_ask" && row.payload?.missedUserId && row.payload?.missed_local_date) {
        const missedUserId = row.payload.missedUserId;
        const { count: coveredCount } = await admin
          .from("completions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", missedUserId)
          .eq("local_date", row.payload.missed_local_date);

        const { data: missedUser } = await admin
          .from("users")
          .select("timezone, away_since")
          .eq("id", missedUserId)
          .maybeSingle();
        const missedTz = missedUser?.timezone || "UTC";
        const { count: selfToday } = await admin
          .from("completions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", missedUserId)
          .eq("kind", "self")
          .eq("local_date", localDateString(now, missedTz));

        let emberAskReason: string | null = null;
        if ((coveredCount ?? 0) > 0) {
          emberAskReason = "already_covered";
        } else if ((selfToday ?? 0) > 0) {
          // They came back on their own. Asking someone to rescue
          // yesterday moments after that reads as not having noticed.
          emberAskReason = "already_checked_in";
        } else if (missedUser?.away_since) {
          emberAskReason = "away";
        } else if (row.payload.circleId) {
          // Still open? Same definition the ask was composed from, and
          // the same one the circle screen's cover pill reads. A closed
          // window here means the day rolled on (or the spell passed
          // Cat's two-day cadence) while this row waited.
          const { data: windowRows } = await admin.rpc("ember_window_for", {
            p_user: missedUserId,
            p_circle_id: row.payload.circleId,
          });
          if ((Array.isArray(windowRows) ? windowRows.length : windowRows ? 1 : 0) === 0) {
            emberAskReason = "expired";
          }
        }

        if (emberAskReason) {
          await admin
            .from("notification_outbox")
            .update({ suppressed_reason: emberAskReason, sent_at: now.toISOString() })
            .eq("id", row.id);
          summary.suppressed++;
          continue;
        }
      }

      // RS1 rejoin staleness guard: re-check they're STILL resting at
      // send time, not just when compose-nudges enqueued this — a row
      // can sit queued for a while (quiet hours, the daily cap), and a
      // real check-in in between means this exact "we missed you" email
      // would land moments after they came back on their own, which
      // reads as a strange non-sequitur rather than a warm welcome.
      if (row.kind === "rest_rejoin" && row.payload?.circleId) {
        const { data: latestCompletion } = await admin
          .from("completions")
          .select("local_date")
          .eq("user_id", row.user_id)
          .eq("circle_id", row.payload.circleId)
          .order("local_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        const todayLocal = localDateString(now, timeZone);
        const daysSinceLastCompletion = latestCompletion?.local_date
          ? daysBetween(latestCompletion.local_date, todayLocal)
          : Infinity;
        if (daysSinceLastCompletion < REJOIN_EMAIL_QUIET_DAYS_THRESHOLD) {
          await admin
            .from("notification_outbox")
            .update({ suppressed_reason: "already_checked_in", sent_at: now.toISOString() })
            .eq("id", row.id);
          summary.suppressed++;
          continue;
        }
      }

      // AL1 job 3 — THE LOCAL REMINDER COUNTS AS ONE OF THE TWO. It never
      // touches this outbox (it is scheduled on the phone, offline, by
      // lib/alarmReminder.ts), so nothing here could ever observe it —
      // which is exactly why the slot has to be reserved rather than
      // counted. For someone with a declared practice time the effective
      // server cap is therefore ONE, and the day's total is reminder + at
      // most one server notification: precisely Cat's "reminder plus one
      // nudge", and it holds at any circle count, because nudge_daily is
      // already dedupe-keyed once per user per local date rather than once
      // per membership.
      //
      // Conservative on purpose (FF1's default direction): we cannot know
      // whether the reminder actually appeared — a phone with
      // notifications denied gets one fewer server notification than it
      // strictly could. Under-notifying someone who asked for a quiet day
      // is the failure worth having.
      //
      // The "never more than 2 a day" promise in settings is unchanged and
      // still literally true.
      const reservesASlotForTheirOwnReminder = user?.alarm_enabled === true && !!user?.alarm_time;
      const effectiveCap = reservesASlotForTheirOwnReminder ? 1 : 2;
      const deliveredToday = await countDeliveredToday(admin, row.user_id, timeZone, now);
      if (deliveredToday >= effectiveCap) {
        await admin
          .from("notification_outbox")
          .update({ suppressed_reason: "cap_reached", sent_at: now.toISOString() })
          .eq("id", row.id);
        summary.suppressed++;
        continue;
      }

      if (prefs && isQuietHours(localTime, prefs.quiet_start, prefs.quiet_end)) {
        // Leave the row untouched — scheduled_for stays in the past, so
        // it's simply reconsidered next cron tick, once local time is
        // past quiet hours. This is what makes a queued send "roll to
        // next morning" for free, with no reschedule math.
        summary.quietHoursSkipped++;
        continue;
      }

      const prefColumn = KIND_TO_PREF_COLUMN[row.kind];
      if (prefs && prefs[prefColumn] === false) {
        await admin
          .from("notification_outbox")
          .update({ suppressed_reason: "pref_disabled", sent_at: now.toISOString() })
          .eq("id", row.id);
        summary.suppressed++;
        continue;
      }

      // "Unless the recipient has the app open / opens it before send, it
      // arrives in-app instead of by email" (spec §4b) — the wall post
      // already happened synchronously when the nudge was sent, so this
      // just decides whether the EMAIL is also worth sending. A last_seen_at
      // within the last few minutes is our best proxy for "active right
      // now" since there's no separate presence/online system. W1 (7 July):
      // 'delivered_in_app', not a generic "seen" reason — the wave already
      // happened via the wall post, this only ever decides the email.
      if (row.kind === "friend_nudge" && user?.last_seen_at) {
        const ACTIVE_WINDOW_MS = 3 * 60 * 1000;
        if (now.getTime() - new Date(user.last_seen_at).getTime() < ACTIVE_WINDOW_MS) {
          await admin
            .from("notification_outbox")
            .update({ suppressed_reason: "delivered_in_app", sent_at: now.toISOString() })
            .eq("id", row.id);
          summary.suppressed++;
          continue;
        }
      }

      if (row.kind === "nudge_daily") {
        const { count: activeCircleCount } = await admin
          .from("memberships")
          .select("circles!inner(is_active)", { count: "exact", head: true })
          .eq("user_id", row.user_id)
          .eq("circles.is_active", true);
        if ((activeCircleCount ?? 0) === 0) {
          await admin
            .from("notification_outbox")
            .update({ suppressed_reason: "no_active_circles", sent_at: now.toISOString() })
            .eq("id", row.id);
          summary.suppressed++;
          continue;
        }
      }

      if (row.kind === "nudge_daily" || row.kind === "friend_nudge") {
        const localDate = localDateString(now, timeZone);
        const { count } = await admin
          .from("completions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", row.user_id)
          .eq("local_date", localDate);
        if ((count ?? 0) > 0) {
          // W1 (7 July): a checked-in recipient's wave already "happened"
          // (wall + digest carry it) — the email is redundant, not a
          // failure, so friend_nudge gets its own distinct reason. A daily
          // nudge reminder truly wasn't needed, so that reason is unchanged.
          await admin
            .from("notification_outbox")
            .update({
              suppressed_reason: row.kind === "friend_nudge" ? "delivered_in_app" : "already_checked_in",
              sent_at: now.toISOString(),
            })
            .eq("id", row.id);
          summary.suppressed++;
          continue;
        }
      }

      if (row.kind === "social_digest" && user?.last_seen_at) {
        if (new Date(user.last_seen_at).getTime() >= new Date(row.scheduled_for).getTime()) {
          await admin
            .from("notification_outbox")
            .update({ suppressed_reason: "seen_in_app", sent_at: now.toISOString() })
            .eq("id", row.id);
          summary.suppressed++;
          continue;
        }
      }

      // New-format friend_nudge rows carry senderName/circleName instead of
      // pre-rendered subject/html (security spec S1, F4) — compose here.
      // Old-format rows (enqueued before this shipped) already have
      // subject/html and fall straight through unchanged.
      let renderedSubject = row.payload?.subject;
      let renderedHtml = row.payload?.html;
      // NQ1: the composer's exact push body when it wrote one; EM1's two
      // kinds compose theirs right here alongside the email, so the push
      // is Cat's words rather than stripped html.
      let renderedPushBody = row.payload?.push_body;
      if (row.kind === "friend_nudge" && !renderedSubject && !renderedHtml && row.payload?.senderName) {
        const composed = composeFriendNudgeEmail(row.payload.senderName);
        renderedSubject = composed.subject;
        renderedHtml = composed.html;
      }
      if (row.kind === "ember_ask" && row.payload?.missedName) {
        const composed = composeEmberAsk(row.payload.missedName);
        renderedSubject = composed.subject;
        renderedHtml = composed.html;
        renderedPushBody = composed.pushBody;
      }
      if (row.kind === "covered_notice" && row.payload?.covererName) {
        const composed = composeCoveredNotice(row.payload.covererName);
        renderedSubject = composed.subject;
        renderedHtml = composed.html;
        renderedPushBody = composed.pushBody;
      }

      // EM1 job 2 — what a TAP should open. Carried on the push only:
      // email has its own link, and nothing here is ever trusted as
      // authorisation (lib/notificationDeepLink.ts says why). The ask
      // needs the asked person's own name too, because CV1's cover screen
      // previews the note the covered member will get ("{myName} covered
      // you for yesterday") and a deep link that skipped it would preview
      // a stranger's words.
      let pushData: Record<string, string> | undefined;
      if (row.kind === "ember_ask" && row.payload?.missedUserId && row.payload?.missed_local_date) {
        pushData = {
          type: "ember_ask",
          circleId: row.payload.circleId ?? "",
          memberId: row.payload.missedUserId,
          memberName: row.payload.missedName ?? "",
          missedDate: row.payload.missed_local_date,
          myName: (user as { name?: string } | null)?.name ?? "",
        };
      } else if (row.kind === "covered_notice") {
        pushData = { type: "covered_notice" };
      }

      if (!renderedSubject || !renderedHtml) {
        console.error(`Outbox row ${row.id} has no renderable payload — skipping`);
        await admin
          .from("notification_outbox")
          .update({ suppressed_reason: "invalid_payload", sent_at: now.toISOString() })
          .eq("id", row.id);
        summary.suppressed++;
        continue;
      }

      // PN1 — anti-pile-on: a live device token means this row goes as
      // PUSH instead of email, never both. A token that Expo immediately
      // reports as DeviceNotRegistered is pruned right away and this row
      // falls through to email below (better a late email than silence);
      // any other push failure (network, Expo outage) does the same.
      try {
        // NQ1: prefer the composer's exact push body (nudge_daily) over
        // stripping the email html; every other kind has no push_body and
        // keeps the stripped-html behaviour.
        const pushBody = renderedPushBody ?? stripHtmlToPushBody(renderedHtml);
        const pushResult = await sendExpoPush(admin, row.user_id, renderedSubject, pushBody, pushData);
        if (pushResult) {
          const { ticket, token: pushToken } = pushResult;
          if (ticket.status === "ok") {
            await admin
              .from("notification_outbox")
              .update({
                sent_at: now.toISOString(),
                channel: "apns",
                push_ticket_id: ticket.id,
                push_token: pushToken,
              })
              .eq("id", row.id);
            summary.sent++;
            summary.pushed++;
            continue;
          }
          console.error(`Push ticket error for outbox row ${row.id}:`, ticket.message);
          if (ticket.details?.error === "DeviceNotRegistered") {
            await admin.from("device_tokens").delete().eq("token", pushToken);
          }
          // falls through to email below
        }
      } catch (e) {
        console.error(`Push send failed for outbox row ${row.id}, falling back to email:`, e instanceof Error ? e.message : e);
      }

      if (!resendApiKey) {
        console.error("RESEND_API_KEY is not configured — cannot send, leaving row for retry");
        summary.failed++;
        continue;
      }

      const { data: authUser } = await admin.auth.admin.getUserById(row.user_id);
      const email = authUser?.user?.email;
      if (!email) {
        console.error(`No email on file for user ${row.user_id} — skipping`);
        await admin
          .from("notification_outbox")
          .update({ suppressed_reason: "no_email", sent_at: now.toISOString() })
          .eq("id", row.id);
        summary.suppressed++;
        continue;
      }

      const token = await signToken(expectedSecret, row.user_id, row.kind);
      const html = renderedHtml + unsubscribeFooter(supabaseUrl, row.user_id, row.kind, token);

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Rally21 <rally21@amsadvisory.uk>",
          to: [email],
          subject: renderedSubject,
          html,
        }),
      });

      if (!resendRes.ok) {
        const text = await resendRes.text();
        console.error(`Resend send failed for outbox row ${row.id}: ${resendRes.status} ${text}`);
        summary.failed++;
        continue;
      }

      await admin
        .from("notification_outbox")
        .update({ sent_at: now.toISOString() })
        .eq("id", row.id);
      summary.sent++;
    } catch (e) {
      console.error(`Unhandled error processing outbox row ${row.id}:`, e instanceof Error ? e.message : e);
      summary.failed++;
    }
  }

  return new Response(JSON.stringify(summary), {
    headers: { "Content-Type": "application/json" },
  });
});
