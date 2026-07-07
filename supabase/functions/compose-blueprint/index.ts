import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  BlueprintContent,
  buildSynthesisPrompt,
  emptyBlueprintContent,
  parseSynthesisProposal,
  pseudonymizeInput,
  synthesizeNextContent,
} from "./synthesis.ts";

// Blueprint v2, part 1 — the weekly LLM synthesis batch
// (Rally21-Blueprint-Notes.md, Adaptive-Intelligence-Spec §3-5). Same
// shared-secret + service-role pattern as compose-digest/compose-nudges:
// invoked by pg_cron via net.http_post, not a user-facing endpoint.
//
// A user's FIRST synthesis (no prior blueprint_versions row) reads their
// FULL history — "blueprints born rich" (Blueprint-Notes, backfill at
// birth). Every later run reads only what's new since the previous
// version's generated_at. Rule enforcement (±0.1 trait cap, one new
// pattern, evidence bar, permanent rejected-statement exclusion) lives in
// synthesis.ts's pure merge code, not in the prompt alone — the model's
// output is a candidate, never trusted at face value.

const MODEL = "claude-haiku-4-5-20251001";
const MAX_PROPOSAL_TOKENS = 800;

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: expectedSecret } = await admin.rpc("get_notifications_secret");
  const providedSecret = req.headers.get("x-notifications-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) {
    console.error("ANTHROPIC_API_KEY is not configured");
    return new Response(JSON.stringify({ error: "compose-blueprint is not configured yet" }), { status: 503 });
  }

  // Optional { user_id } filter — used for CHECKPOINT (b)'s single-account
  // test run and for any future targeted re-run; omitted, it's the whole
  // cohort (friends-scale, safe to process in one invocation, same as
  // compose-digest/compose-nudges already do).
  let body: { user_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine — the normal weekly cron call
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const summary = {
    candidates: 0,
    synthesized: 0,
    skippedNoReflections: 0,
    malformed: 0,
    backfills: 0,
    newPatternsApplied: 0,
    wantsApplied: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };

  let usersQuery = admin.from("users").select("id");
  if (body.user_id) usersQuery = usersQuery.eq("id", body.user_id);
  const { data: users, error: usersError } = await usersQuery;

  if (usersError) {
    console.error("Could not load blueprint synthesis candidates:", usersError.message);
    return new Response(JSON.stringify({ error: usersError.message }), { status: 500 });
  }

  for (const user of users ?? []) {
    summary.candidates++;
    try {
      const { data: prevVersions, error: prevError } = await admin
        .from("blueprint_versions")
        .select("version, content, generated_at")
        .eq("user_id", user.id)
        .order("version", { ascending: false })
        .limit(1);

      if (prevError) {
        console.error(`Could not load previous blueprint_versions for user ${user.id}:`, prevError.message);
        continue;
      }

      const prevRow = prevVersions?.[0] ?? null;
      const isBackfill = !prevRow;
      const sinceIso: string | null = prevRow ? (prevRow.generated_at as string) : null;
      const previousContent: BlueprintContent = prevRow
        ? (prevRow.content as BlueprintContent)
        : emptyBlueprintContent({ reflections_through: null, completions_through: null, is_backfill: true });

      let reflectionsQuery = admin
        .from("reflections")
        .select("local_date, mood, line1, line2, question_answer, questions(dimension)")
        .eq("user_id", user.id)
        .order("local_date", { ascending: true });
      if (sinceIso) reflectionsQuery = reflectionsQuery.gt("created_at", sinceIso);
      const { data: reflectionRows, error: reflectionsError } = await reflectionsQuery;

      if (reflectionsError) {
        console.error(`Could not load reflections for user ${user.id}:`, reflectionsError.message);
        continue;
      }

      if (!reflectionRows || reflectionRows.length === 0) {
        summary.skippedNoReflections++;
        continue;
      }

      let completionsQuery = admin
        .from("completions")
        .select("local_date, created_at")
        .eq("user_id", user.id)
        .eq("kind", "self")
        .order("local_date", { ascending: true });
      if (sinceIso) completionsQuery = completionsQuery.gt("created_at", sinceIso);
      const { data: completionRows } = await completionsQuery;

      // Corrections are all-time, never windowed — a not_quite from months
      // ago still governs whether its statement can resurface today.
      const { data: responseRows } = await admin
        .from("blueprint_responses")
        .select("pattern_key, response, note, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      const input = pseudonymizeInput({
        reflections: reflectionRows.map((r: any) => ({
          local_date: r.local_date,
          mood: r.mood,
          line1: r.line1,
          line2: r.line2,
          question_dimension: r.questions?.dimension ?? null,
          question_answer: r.question_answer,
        })),
        completions: (completionRows ?? []).map((c) => ({ local_date: c.local_date })),
        responses: (responseRows ?? []).map((r) => ({
          pattern_key: r.pattern_key,
          response: r.response as "confirmed" | "not_quite",
          note: r.note,
        })),
      });

      const hasActiveWant = previousContent.wants.some((w) => w.status !== "rejected");
      const prompt = buildSynthesisPrompt(input, {
        existingPatternKeys: previousContent.patterns.map((p) => p.key),
        hasActiveWant,
        rejectedStatements: previousContent.rejected_statements,
        isFirstSynthesis: isBackfill,
      });

      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_PROPOSAL_TOKENS,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
        }),
      });

      if (!anthropicRes.ok) {
        const text = await anthropicRes.text().catch(() => "");
        console.error(`Anthropic API error ${anthropicRes.status} for user ${user.id}: ${text}`);
        continue;
      }

      const anthropicJson = await anthropicRes.json();
      const rawText: string = anthropicJson?.content?.[0]?.text ?? "";
      // Token counts only, never content — the spec's own cost-logging rule.
      const inputTokens = anthropicJson?.usage?.input_tokens ?? 0;
      const outputTokens = anthropicJson?.usage?.output_tokens ?? 0;
      summary.totalInputTokens += inputTokens;
      summary.totalOutputTokens += outputTokens;
      console.log(`compose-blueprint user=${user.id} input_tokens=${inputTokens} output_tokens=${outputTokens}`);

      const proposal = parseSynthesisProposal(rawText);
      if (!proposal) {
        console.error(`Malformed synthesis proposal for user ${user.id} — keeping previous version`);
        summary.malformed++;
        continue;
      }

      const lastReflectionDate = reflectionRows[reflectionRows.length - 1]?.local_date ?? null;
      const lastCompletionDate = (completionRows ?? [])[(completionRows ?? []).length - 1]?.local_date ?? null;

      const result = synthesizeNextContent({
        previous: previousContent,
        responses: input.responses,
        proposal,
        nowIso,
        generatedFrom: {
          reflections_through: lastReflectionDate,
          completions_through: lastCompletionDate,
          is_backfill: isBackfill,
        },
      });

      const { error: insertError } = await admin.from("blueprint_versions").insert({
        user_id: user.id,
        version: (prevRow?.version ?? 0) + 1,
        content: result.content,
        source: "system",
        generated_at: nowIso,
      });

      if (insertError) {
        console.error(`Could not write blueprint_versions for user ${user.id}:`, insertError.message);
        continue;
      }

      summary.synthesized++;
      if (isBackfill) summary.backfills++;
      if (result.appliedNewPattern) summary.newPatternsApplied++;
      if (result.appliedWant) summary.wantsApplied++;
    } catch (e) {
      console.error(`Unhandled error composing blueprint for user ${user.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
});
