import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// One-click unsubscribe, no login (legally required — spec §5). The link
// is signed with the same shared secret the sender uses (read from Vault
// via a service-role-only RPC, not a separately-configured Deno env var —
// one source of truth), over `${userId}:${kind}`, so it can't be forged or
// reused for a different user/kind and needs no separate token table or
// expiry. verify_jwt is off (a browser hitting an email link carries no
// Supabase session), so this signature check IS the auth.
const KIND_TO_PREF_COLUMN: Record<string, string> = {
  nudge_daily: "nudge_enabled",
  social_digest: "digest_enabled",
  friend_nudge: "friend_nudge_enabled",
};

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

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #fbf6ee; color: #2b2b2b;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
  .card { max-width: 420px; text-align: center; }
  h1 { font-size: 20px; }
  p { font-size: 14px; color: #6b6b6b; line-height: 1.5; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get("u");
  const kind = url.searchParams.get("k");
  const token = url.searchParams.get("t");
  const prefColumn = kind ? KIND_TO_PREF_COLUMN[kind] : null;

  if (!userId || !kind || !token || !prefColumn) {
    return page("that link isn't quite right", "double-check you copied the whole link from the email.", 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: secret } = await admin.rpc("get_notifications_secret");

  if (!secret) {
    return page("something went wrong", "please try again in a moment.", 500);
  }

  // CH5 (22 July): rotation-safe verification. New links are signed with
  // the CURRENT secret; links in emails sent before a rotation carry the
  // PREVIOUS one, which Vault keeps as 'notifications_secret_prev' — an
  // unsubscribe link must keep working across a rotation (it's the one
  // signed artifact that lives on in people's inboxes). Exactly one
  // generation back is honored, never a chain.
  let verified = (await signToken(secret, userId, kind)) === token;
  if (!verified) {
    const { data: prevSecret } = await admin.rpc("get_notifications_secret_prev");
    if (prevSecret) {
      verified = (await signToken(prevSecret, userId, kind)) === token;
    }
  }
  if (!verified) {
    return page("that link isn't quite right", "double-check you copied the whole link from the email.", 400);
  }

  const { error } = await admin
    .from("notification_prefs")
    .update({ [prefColumn]: false })
    .eq("user_id", userId);

  if (error) {
    console.error("Unsubscribe update failed:", error.message);
    return page("something went wrong", "please try again in a moment.", 500);
  }

  return page("done — you're unsubscribed", "no hard feelings — your circle still glows 💛");
});
