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
// A row's payload is always `{ subject: string, html: string }` — fully
// rendered by whichever composer created it. This function never builds
// copy itself.

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
  kind: "nudge_daily" | "social_digest" | "friend_nudge";
  payload: { subject?: string; html?: string; local_date?: string };
  scheduled_for: string;
};

const KIND_TO_PREF_COLUMN: Record<OutboxRow["kind"], keyof PrefRow> = {
  nudge_daily: "nudge_enabled",
  social_digest: "digest_enabled",
  friend_nudge: "friend_nudge_enabled",
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

function unsubscribeFooter(supabaseUrl: string, userId: string, kind: string, token: string): string {
  const link = `${supabaseUrl}/functions/v1/unsubscribe?u=${userId}&k=${kind}&t=${token}`;
  return `<hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px" />
<p style="font-size:11px;color:#999;line-height:1.5">
  <a href="${link}" style="color:#999">unsubscribe from these</a> — no hard feelings, your circle still glows 💛
</p>`;
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
  const summary = { processed: 0, sent: 0, suppressed: 0, quietHoursSkipped: 0, failed: 0 };

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
      // Composers that embed payload.local_date (currently just the daily
      // nudge) get this staleness guard for free; a row never expires
      // sooner than actually queued, since it's only ever behind "today".
      if (row.payload?.local_date) {
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
          await admin
            .from("notification_outbox")
            .update({ suppressed_reason: "already_checked_in", sent_at: now.toISOString() })
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

      if (!row.payload?.subject || !row.payload?.html) {
        console.error(`Outbox row ${row.id} has no renderable payload — skipping`);
        await admin
          .from("notification_outbox")
          .update({ suppressed_reason: "invalid_payload", sent_at: now.toISOString() })
          .eq("id", row.id);
        summary.suppressed++;
        continue;
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
      const html = row.payload.html + unsubscribeFooter(supabaseUrl, row.user_id, row.kind, token);

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Rally21 <rally21@amsadvisory.uk>",
          to: [email],
          subject: row.payload.subject,
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
