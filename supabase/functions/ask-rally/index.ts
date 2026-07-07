import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  assembleAskRallySystemPrompt,
  buildBlueprintBlock,
  buildCircleBlock,
  buildReflectionsBlock,
  buildStatesBlock,
  buildWantsNote,
  CircleSummary,
  countMessagesOnLocalDate,
  DAILY_MESSAGE_LIMIT,
  RATE_LIMIT_MESSAGE,
} from "./context.ts";
import {
  ChatMessage,
  crisisResponse,
  isCrisisMessage,
  resolveCrisisResources,
  SYSTEM_PROMPT_TEMPLATE,
  truncateHistory,
} from "./system-prompt.ts";

// Ask Rally, part 1 — the real thing (Rally21-Ask-Rally-Spec.md). A0's
// fixture-based playground grows up: real context assembly (context.ts),
// real persistence (ask_conversations/ask_messages, owner-only RLS), the
// daily rate limit, and no more founder allowlist — every authenticated
// user.
//
// Everything below runs as the CALLER, through their own JWT — no
// service-role client anywhere in this function. Every table touched
// (blueprint_versions, reflections, completions, memberships/circles,
// want_activations, ask_conversations, ask_messages) is already
// owner/member-scoped by RLS, and get_my_glow()/get_my_blueprint() are
// both auth.uid()-scoped wrappers, not the service-role variants.

const MODEL = "claude-haiku-4-5-20251001";
const MAX_REPLY_TOKENS = 400;
const MAX_HISTORY_TURNS = 20;
// Plenty to cover even a maxed-out day (limit is 5) without scanning the
// whole ask_messages history for a long-lived account.
const RECENT_MESSAGES_FOR_RATE_LIMIT = 50;

function dayNumberAt(startDate: string, atMs: number): number {
  const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
  return Math.floor((atMs - startMs) / 86400000) + 1;
}

function localDateString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

function textStreamResponse(text: string, extraHeaders: Record<string, string> = {}): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", ...extraHeaders },
  });
}

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

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
  }
  const userId = userData.user.id;

  let body: { message?: string; startFresh?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const messageText = (body.message ?? "").trim();
  if (!messageText) {
    return new Response(JSON.stringify({ error: "message is required" }), { status: 400 });
  }

  // "start fresh" (spec §6: "reinforces the privacy story") closes any
  // open thread before we look for/create one — never deletes it, that's
  // a separate one-tap action.
  if (body.startFresh) {
    await client.from("ask_conversations").update({ closed_at: new Date().toISOString() }).is("closed_at", null);
  }

  let activeConversationId: string;
  const { data: existingConversation } = await client
    .from("ask_conversations")
    .select("id")
    .is("closed_at", null)
    .maybeSingle<{ id: string }>();

  if (existingConversation) {
    activeConversationId = existingConversation.id;
  } else {
    const { data: created, error: createError } = await client
      .from("ask_conversations")
      .insert({ user_id: userId })
      .select("id")
      .single<{ id: string }>();
    if (createError || !created) {
      console.error("Could not create ask_conversation:", createError?.message);
      return new Response(JSON.stringify({ error: "could not start a conversation" }), { status: 500 });
    }
    activeConversationId = created.id;
  }

  const crisisResources = resolveCrisisResources();

  // Crisis pre-check (spec §8): the fixed response WITHOUT ever calling
  // the model. Deliberately checked BEFORE the daily rate limit below —
  // "the floor" (spec §1) is non-negotiable, and a support-seeking
  // message must never be throttled by the day's message count. Still
  // persisted like any other turn — the privacy promise is about where
  // the data goes (nowhere but this conversation), not whether the
  // conversation itself is remembered for continuity.
  if (isCrisisMessage(messageText)) {
    const reply = crisisResponse(crisisResources);
    await client.from("ask_messages").insert([
      { conversation_id: activeConversationId, user_id: userId, role: "user", content: messageText },
      { conversation_id: activeConversationId, user_id: userId, role: "assistant", content: reply },
    ]);
    return textStreamResponse(reply, { "X-Ask-Rally-Crisis": "true" });
  }

  // Daily rate limit — 5 user messages per LOCAL day (users.timezone),
  // resolved the same way compose-nudges resolves local dates: compare
  // each message's own local-date string rather than computing a UTC
  // day-boundary instant (Deno has no IANA conversion library).
  const { data: userRow } = await client
    .from("users")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle<{ timezone: string | null }>();
  const timeZone = userRow?.timezone ?? "UTC";

  const { data: recentUserMessages } = await client
    .from("ask_messages")
    .select("created_at")
    .eq("user_id", userId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(RECENT_MESSAGES_FOR_RATE_LIMIT);

  const todaysMessageCount = countMessagesOnLocalDate(
    (recentUserMessages ?? []).map((m) => m.created_at as string),
    timeZone,
    new Date()
  );

  if (todaysMessageCount >= DAILY_MESSAGE_LIMIT) {
    return textStreamResponse(RATE_LIMIT_MESSAGE, { "X-Ask-Rally-Limited": "true" });
  }

  if (!anthropicApiKey) {
    console.error("ANTHROPIC_API_KEY is not configured");
    return new Response(JSON.stringify({ error: "Ask Rally is not configured yet" }), { status: 503 });
  }

  // ---- context assembly — fresh every request. "Deletion wins races"
  // holds structurally: every read here is live (get_my_blueprint()
  // already excludes not_quite patterns; reflections are queried fresh),
  // so anything the user deleted or rejected before THIS message is
  // already absent. Anthropic's own prompt cache still hits across turns
  // within a conversation since the assembled text is byte-identical
  // when nothing's actually changed. ----

  const now = new Date();
  const today = localDateString(now, timeZone);

  const [blueprintVersionResult, patternsResult, reflectionsResult, glowResult, membershipsResult, activationsResult, priorMessagesResult] =
    await Promise.all([
      client.from("blueprint_versions").select("content").order("version", { ascending: false }).limit(1).maybeSingle<{ content: any }>(),
      client.rpc("get_my_blueprint"),
      client.from("reflections").select("local_date, mood, line1, line2").order("local_date", { ascending: false }).limit(7),
      client.rpc("get_my_glow"),
      client
        .from("memberships")
        .select("circles!inner(id, name, start_date, completed_at, practices(name))")
        .eq("user_id", userId),
      client.from("want_activations").select("want_key"),
      client
        .from("ask_messages")
        .select("role, content")
        .eq("conversation_id", activeConversationId)
        .order("created_at", { ascending: true }),
    ]);

  const content = blueprintVersionResult.data?.content ?? {};
  const traits = content.traits ?? [];
  const coverage = content.coverage ?? {};
  const wantRow = (content.wants ?? [])[0];
  const activatedWantKeys = new Set((activationsResult.data ?? []).map((a: any) => a.want_key as string));

  const patternRows = (patternsResult.data ?? []).map((p: any) => ({
    patternType: p.pattern_type,
    weekday: p.weekday,
    direction: p.direction,
    cutoffHour: p.cutoff_hour,
    agreementCount: p.agreement_count,
    totalCount: p.total_count,
    statement: p.statement,
  }));

  const blueprintBlock = buildBlueprintBlock({ traits, patterns: patternRows, coverage });

  const reflectionRows = reflectionsResult.data ?? [];
  const moodsChronological = reflectionRows
    .map((r: any) => r.mood as number | null)
    .filter((m): m is number => m !== null)
    .reverse(); // fetched most-recent-first; trend needs oldest-first
  const glowRaw = Array.isArray(glowResult.data) ? glowResult.data[0] : glowResult.data;
  const glow = glowRaw
    ? { glow: glowRaw.glow as number, state: glowRaw.state as "glowing" | "embers" | "cold", emberDeadline: glowRaw.ember_deadline ?? null }
    : null;
  const statesBlock = buildStatesBlock({ last7Moods: moodsChronological, glow });

  const reflectionsBlock = buildReflectionsBlock(
    reflectionRows.map((r: any) => ({ localDate: r.local_date, line1: r.line1, line2: r.line2 }))
  );

  const activeCircles = (membershipsResult.data ?? [])
    .map((row: any) => ({
      id: row.circles?.id as string,
      name: row.circles?.name as string,
      startDate: row.circles?.start_date as string,
      completedAt: row.circles?.completed_at as string | null,
      practiceName: (row.circles?.practices?.name as string | undefined) ?? "your practice",
    }))
    .filter((c) => !c.completedAt);

  let circleBlock = "Not currently in any active circle.";
  if (activeCircles.length > 0) {
    const circleIds = activeCircles.map((c) => c.id);
    const [{ data: todaysCompletions }, { data: allMemberships }] = await Promise.all([
      client.from("completions").select("circle_id, user_id").in("circle_id", circleIds).eq("local_date", today),
      client.from("memberships").select("circle_id, user_id").in("circle_id", circleIds),
    ]);
    const memberCountByCircle = new Map<string, number>();
    for (const m of allMemberships ?? []) {
      memberCountByCircle.set(m.circle_id, (memberCountByCircle.get(m.circle_id) ?? 0) + 1);
    }
    const checkedInByCircle = new Map<string, Set<string>>();
    for (const c of todaysCompletions ?? []) {
      if (!checkedInByCircle.has(c.circle_id)) checkedInByCircle.set(c.circle_id, new Set());
      checkedInByCircle.get(c.circle_id)!.add(c.user_id);
    }
    const summaries: CircleSummary[] = activeCircles.map((c) => ({
      practiceName: c.practiceName,
      dayNumber: Math.max(1, dayNumberAt(c.startDate, now.getTime())),
      circleName: c.name,
      checkedIn: checkedInByCircle.get(c.id)?.size ?? 0,
      memberCount: memberCountByCircle.get(c.id) ?? 0,
    }));
    circleBlock = buildCircleBlock(summaries);
  }

  const wantsNote = buildWantsNote({
    wantStatement: wantRow && wantRow.status === "confirmed" ? wantRow.statement : null,
    hasActivation: wantRow ? activatedWantKeys.has(wantRow.key) : false,
  });

  const systemPrompt = assembleAskRallySystemPrompt({
    template: SYSTEM_PROMPT_TEMPLATE,
    crisisResources,
    blueprintBlock,
    statesBlock,
    reflectionsBlock,
    circleBlock,
    wantsNote,
  });

  // Persist the user's turn before calling the model — never lost even if
  // the provider call fails.
  await client.from("ask_messages").insert({
    conversation_id: activeConversationId,
    user_id: userId,
    role: "user",
    content: messageText,
  });

  const priorMessages: ChatMessage[] = (priorMessagesResult.data ?? []).map((m: any) => ({
    role: m.role,
    content: m.content,
  }));
  const fullHistory: ChatMessage[] = [...priorMessages, { role: "user", content: messageText }];
  const truncatedMessages = truncateHistory(fullHistory, MAX_HISTORY_TURNS);

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

  // Relay Anthropic's SSE stream to the client as plain text deltas only,
  // accumulating the full reply so it can be persisted once the stream
  // ends — token counts only ever get logged (never content), per the
  // spec's "no analytics beyond count/latency" rule.
  const upstreamBody = anthropicRes.body;
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      let fullReply = "";
      let inputTokens = 0;
      let outputTokens = 0;
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
                fullReply += event.delta.text;
                controller.enqueue(encoder.encode(event.delta.text as string));
              }
              if (event.type === "message_start" && event.message?.usage?.input_tokens) {
                inputTokens = event.message.usage.input_tokens;
              }
              if (event.type === "message_delta" && event.usage?.output_tokens) {
                outputTokens = event.usage.output_tokens;
              }
            } catch {
              // malformed SSE line — skip it, don't fail the whole stream
            }
          }
        }
      } finally {
        console.log(`ask-rally user=${userId} input_tokens=${inputTokens} output_tokens=${outputTokens}`);
        if (fullReply) {
          await client.from("ask_messages").insert({
            conversation_id: activeConversationId,
            user_id: userId,
            role: "assistant",
            content: fullReply,
          });
        }
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});
