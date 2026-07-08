import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// MOD1 (7 July) — report + block, the safety floor. This is a real edge
// function (not a raw SQL RPC) specifically so the report email to Cat
// can go out IMMEDIATELY, bypassing the per-user notification_outbox
// pipeline entirely — that pipeline applies the RECIPIENT's own quiet
// hours, per-kind pref toggle, and ≤2/day cap (send-notifications/
// index.ts), which is exactly right for Cat's own personal engagement
// nudges but completely wrong for a moderation alert: it must never be
// silently held back because Cat happened to be in her own quiet hours
// or had already received two unrelated emails that day.
//
// This function only SENDS the alert email (best-effort — a failure
// here never fails the request, since the reports row is the durable
// source of truth the founder /reports screen always shows regardless
// of email delivery). The actual report is written by report_content(),
// a SECURITY DEFINER RPC called first, as the caller's own JWT, so RLS
// scopes it to their own reporter_id exactly as if they'd called it
// directly from the client — this function is a thin wrapper adding
// the email side effect, not a privileged bypass of anything.
//
// CORS: called from the browser via supabase.functions.invoke (a real
// fetch under the hood), so it needs the same OPTIONS + CORS-headers-
// on-every-response handling as every other browser-invoked function
// this project has (see ask-rally/index.ts, delete-account/index.ts).
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FOUNDER_EMAIL = "catherine.f.harwood@gmail.com";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }
  const userId = userData.user.id;

  let body: { targetKind?: string; targetId?: string; reason?: string; contextCircleId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const targetKind = body.targetKind;
  const targetId = body.targetId;
  if (targetKind !== "wall_message" && targetKind !== "member" && targetKind !== "circle") {
    return jsonResponse({ error: "invalid target kind" }, 400);
  }
  if (!targetId) {
    return jsonResponse({ error: "targetId is required" }, 400);
  }

  const { error: reportError } = await client.rpc("report_content", {
    p_target_kind: targetKind,
    p_target_id: targetId,
    p_reason: body.reason ?? null,
    p_context_circle_id: body.contextCircleId ?? null,
  });
  if (reportError) {
    return jsonResponse({ error: reportError.message }, 500);
  }

  // Everything from here is best-effort — the report is already saved.
  try {
    const { data: reporter } = await client.from("users").select("name").eq("id", userId).maybeSingle();
    const reporterName = reporter?.name ?? "someone";

    let subject = "";
    let detail = "";

    if (targetKind === "wall_message") {
      const { data: wm } = await client
        .from("wall_messages")
        .select("body, user_id, circles(name)")
        .eq("id", targetId)
        .maybeSingle<{ body: string; user_id: string; circles: { name: string } | null }>();
      subject = `Reported: a wall message in ${wm?.circles?.name ?? "a circle"}`;
      detail = `Message: "${escapeHtml(wm?.body ?? "(not found)")}"<br>Circle: ${escapeHtml(
        wm?.circles?.name ?? "unknown"
      )}`;
    } else if (targetKind === "member") {
      const { data: member } = await client.from("users").select("name").eq("id", targetId).maybeSingle();
      subject = `Reported: a member (${member?.name ?? "unknown"})`;
      detail = `Member: ${escapeHtml(member?.name ?? "unknown")}`;
    } else {
      const { data: circle } = await client
        .from("circles")
        .select("name, practices(name)")
        .eq("id", targetId)
        .maybeSingle<{ name: string; practices: { name: string } | null }>();
      subject = `Reported: circle "${circle?.name ?? "unknown"}"`;
      detail = `Circle: ${escapeHtml(circle?.name ?? "unknown")}${
        circle?.practices?.name ? ` (${escapeHtml(circle.practices.name)})` : ""
      }`;
    }

    const reasonLine = body.reason ? `<p>Reason given: "${escapeHtml(body.reason)}"</p>` : "<p>No reason given.</p>";
    const html = `<p>Reported by: ${escapeHtml(reporterName)}</p><p>${detail}</p>${reasonLine}<p>Review in /reports.</p>`;

    if (resendApiKey) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Rally21 <rally21@amsadvisory.uk>",
          to: [FOUNDER_EMAIL],
          subject,
          html,
        }),
      });
    } else {
      console.error("RESEND_API_KEY is not configured — report saved, alert email not sent");
    }
  } catch (e) {
    console.error("report-content: alert email failed (report already saved):", e instanceof Error ? e.message : e);
  }

  return jsonResponse({ success: true }, 200);
});
