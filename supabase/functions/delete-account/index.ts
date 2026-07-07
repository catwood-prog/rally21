import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Deletes the calling user's own account (security spec S1). verify_jwt=true
// means Supabase has already rejected unauthenticated requests before this
// code runs; we still resolve the caller's own id from their JWT (never
// trust a client-supplied id) and only ever delete that one account.
//
// Order matters: delete_account_prep (service-role-only, idempotent) MUST
// run before auth.admin.deleteUser. It transfers hosted circles with other
// members to the earliest remaining member, deletes hosted circles with no
// other members, deactivates circles where the caller is the last member,
// and resolves practices.created_by (delete unreferenced customs, null out
// the rest) — practices.created_by is deliberately ON DELETE NO ACTION so
// any deletion path that skips prep fails loudly instead of mis-cascading
// (F5, see ../../../Rally21-Security-Spec.md). Everything else (memberships,
// completions, reflections, wall_messages, checkin_reactions,
// wall_message_reactions, notification_prefs, notification_outbox,
// blueprint_versions, device_tokens) cascades from public.users, which
// itself cascades from auth.users. (blueprint_versions + device_tokens
// verified CASCADE against the live schema, 6 July.)
//
// Idempotent end to end: delete_account_prep is safe to re-run, the avatar
// removal is a no-op once the folder is already empty, and a "not found"
// error from deleteUser (the auth user is already gone) is treated as
// success rather than failure — a retry after a partial prior run must not
// error just because the desired end state already holds.
//
// A3 (7 July): called from the browser via supabase.functions.invoke
// (lib/account.ts), which is a real fetch() under the hood — needs the
// same OPTIONS-preflight + CORS-header-on-every-response handling as
// ask-rally, or it fails with "Failed to fetch" before ever reaching auth.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }
  const userId = userData.user.id;

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { error: prepError } = await adminClient.rpc("delete_account_prep", { p_user_id: userId });
  if (prepError) {
    console.error(`delete_account_prep failed for ${userId}:`, prepError.message);
    return jsonResponse({ error: prepError.message }, 500);
  }

  const { data: files, error: listError } = await adminClient.storage.from("avatars").list(userId);
  if (listError) {
    console.error(`Could not list avatar objects for ${userId}:`, listError.message);
  } else if (files && files.length > 0) {
    const paths = files.map((f) => `${userId}/${f.name}`);
    const { error: removeError } = await adminClient.storage.from("avatars").remove(paths);
    if (removeError) {
      console.error(`Could not remove avatar objects for ${userId}:`, removeError.message);
    }
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError && !deleteError.message?.toLowerCase().includes("not found")) {
    console.error(`auth.admin.deleteUser failed for ${userId}:`, deleteError.message);
    return jsonResponse({ error: deleteError.message }, 500);
  }

  return jsonResponse({ success: true }, 200);
});
