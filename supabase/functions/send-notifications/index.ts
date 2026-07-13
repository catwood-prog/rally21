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
  kind: "nudge_daily" | "social_digest" | "friend_nudge" | "ember_nudge";
  payload: {
    subject?: string;
    html?: string;
    local_date?: string;
    senderName?: string;
    circleName?: string;
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

const KIND_TO_PREF_COLUMN: Record<OutboxRow["kind"], keyof PrefRow> = {
  nudge_daily: "nudge_enabled",
  social_digest: "digest_enabled",
  friend_nudge: "friend_nudge_enabled",
  // The ember nudge rides the same pref — it IS the daily nudge for an
  // ember day (Rally21-Glow-Spec.md §6).
  ember_nudge: "nudge_enabled",
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
  body: string
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
    body: JSON.stringify([{ to: device.token, title, body, sound: "default" }]),
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
        .select("timezone, last_seen_at")
        .eq("id", row.user_id)
        .single();
      const { data: prefs } = await admin
        .from("notification_prefs")
        .select("nudge_enabled, digest_enabled, friend_nudge_enabled, quiet_start, quiet_end")
        .eq("user_id", row.user_id)
        .single();

      const timeZone = user?.timezone || "UTC";
      const localTime = localTimeString(now, timeZone);

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

      const deliveredToday = await countDeliveredToday(admin, row.user_id, timeZone, now);
      if (deliveredToday >= 2) {
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
      if (row.kind === "friend_nudge" && !renderedSubject && !renderedHtml && row.payload?.senderName) {
        const composed = composeFriendNudgeEmail(row.payload.senderName);
        renderedSubject = composed.subject;
        renderedHtml = composed.html;
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
        const pushResult = await sendExpoPush(admin, row.user_id, renderedSubject, stripHtmlToPushBody(renderedHtml));
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
