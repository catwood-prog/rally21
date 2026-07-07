import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  assembleSystemPrompt,
  ChatMessage,
  crisisResponse,
  isCrisisMessage,
  isFounder,
  resolveCrisisResources,
  truncateHistory,
} from "./system-prompt.ts";

// Ask Rally, part 0 — the tone playground (Rally21-Ask-Rally-Spec.md).
// Founder-only sandbox to test the persona and crisis machinery BEFORE any
// blueprint engine exists. SCOPE: nothing persists here — no conversation
// table, no rate-limit counter (a real per-user rate limiter needs storage,
// which is explicitly out of scope for A0; this is a single-founder
// sandbox, revisit once A1 opens this to real users). Same house edge-
// function auth pattern as delete-account: verify_jwt=true rejects
// unauthenticated requests at the platform level; we still resolve the
// caller's own id from their JWT (never trust a client-supplied id).

// Same two-account allowlist as app_caps()'s founder override
// (supabase/migrations/20260706082724_app_caps_personal_override_for_founder.sql)
// — kept in sync by hand, same convention as compose-nudges' copied
// constants (this Deno file has no access to that SQL).
const FOUNDER_IDS = new Set([
  "75ec0d88-27de-4227-ab62-3d049b369960", // catherine.f.harwood@gmail.com
  "149bac2f-6557-403b-bf05-f830d42fc2e4", // catherine.harwood@korefusion.com (test)
]);

// Haiku-class per spec §4 — the current model ID at build time.
const MODEL = "claude-haiku-4-5-20251001";
const MAX_REPLY_TOKENS = 400;
const MAX_HISTORY_TURNS = 20;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
  }

  // Server-side gate — the real enforcement. The client also redirects
  // non-founders home, but that's UX only; this 403 is what actually
  // protects the sandbox (spec: "never rely on the client gate alone").
  if (!isFounder(userData.user.id, FOUNDER_IDS)) {
    return new Response(JSON.stringify({ error: "Founder only" }), { status: 403 });
  }

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages is required" }), { status: 400 });
  }

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const crisisResources = resolveCrisisResources();

  // Crisis pre-check (spec §8): returns the fixed response WITHOUT ever
  // calling the model, whenever the LATEST user turn matches a high-
  // precision phrase. The system prompt's own crisis instructions are the
  // recall layer for anything this misses.
  if (lastUserMessage && isCrisisMessage(lastUserMessage.content)) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(crisisResponse(crisisResources)));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Ask-Rally-Crisis": "true" },
    });
  }

  if (!anthropicApiKey) {
    console.error("ANTHROPIC_API_KEY is not configured");
    return new Response(JSON.stringify({ error: "Ask Rally is not configured yet" }), { status: 503 });
  }

  const truncatedMessages = truncateHistory(messages, MAX_HISTORY_TURNS);

  const systemPrompt = assembleSystemPrompt(crisisResources);

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_REPLY_TOKENS,
      // Prompt caching (Anthropic API) — the system block is assembled
      // once per conversation and re-sent every turn; caching it means
      // only the first turn pays full input-token price for it.
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: truncatedMessages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    }),
  });

  if (!anthropicRes.ok || !anthropicRes.body) {
    const text = await anthropicRes.text().catch(() => "");
    console.error(`Anthropic API error ${anthropicRes.status}: ${text}`);
    return new Response(JSON.stringify({ error: "Ask Rally couldn't respond — try again" }), { status: 502 });
  }

  // Relay Anthropic's SSE stream to the client as plain text deltas only
  // — the client never needs to parse SSE, just append each chunk.
  const upstreamBody = anthropicRes.body;
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                controller.enqueue(encoder.encode(event.delta.text as string));
              }
            } catch {
              // malformed SSE line — skip it, don't fail the whole stream
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});
