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
import { ChipAnswer, findDominantChipCandidates, mergeChipTraitCandidates } from "./chip-traits.ts";
import {
  buildContrastPrompt,
  contrastGate,
  ContrastFactSheet,
  isVulnerableDay,
  mergeContrastCard,
  parseContrastProposal,
  validateContrastProposal,
} from "./contrast.ts";

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
// MN3's second call writes one sentence. It gets a small ceiling on purpose:
// a model that needs 300 tokens for one sentence is not writing the sentence.
const MAX_CONTRAST_TOKENS = 200;

/** Same shape compose-nudges uses (en-CA gives YYYY-MM-DD directly). */
function localDateString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

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
    chipTraitsApplied: 0,
    // MN3. `contrastsDropped` is the number that matters most on this
    // function: it counts cards the validator refused, and a run where it
    // climbs is a run to look at before anyone sees anything.
    contrastCandidates: 0,
    contrastsApplied: 0,
    contrastsDropped: 0,
    contrastsHeld: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };

  // MN3's kill switch, read ONCE per run. Off means no card is generated or
  // stored for anyone; get_my_blueprint independently refuses to serve any
  // that already exist, so one row hides the whole feature with no deploy.
  const { data: flagRow } = await admin
    .from("app_flags")
    .select("enabled")
    .eq("key", "contrast_cards_enabled")
    .maybeSingle();
  // Absent flag row = off. A feature that makes claims about people fails
  // closed, always.
  const contrastsEnabled = flagRow?.enabled === true;
  if (!contrastsEnabled) console.log("compose-blueprint: contrast cards are OFF (app_flags)");

  let usersQuery = admin.from("users").select("id, timezone");
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

      // Q1's deterministic lane (chip-trait candidates, zero LLM cost) —
      // needs the user's FULL chip-answer history regardless of the
      // incremental `sinceIso` cursor above, since "3 of last 4 asks"
      // can span further back than whatever changed since the last run.
      // RA1 job 3: `code` comes back too, because the family is now the
      // QUESTION rather than the dimension.
      const { data: chipRows } = await admin
        .from("reflections")
        .select("local_date, question_answer, questions(code, dimension, format)")
        .eq("user_id", user.id)
        .not("question_answer", "is", null)
        .order("local_date", { ascending: true });

      const chipAnswers: ChipAnswer[] = (chipRows ?? [])
        .filter((r: any) => r.questions?.format === "chips" && r.questions?.code)
        .map((r: any) => ({
          local_date: r.local_date,
          question_code: r.questions.code,
          dimension: r.questions.dimension,
          chip_value: r.question_answer,
        }));

      const chipCandidates = findDominantChipCandidates(chipAnswers);
      const chipMerge = mergeChipTraitCandidates({
        previousTraits: result.content.traits,
        candidates: chipCandidates,
        nowIso,
      });
      result.content.traits = chipMerge.traits;
      // RA1 job 3: pre-RA1 chip keys were grouped by dimension and cannot
      // be attributed to a question, so they are dropped and re-derived
      // from raw answers. Never silently — a run that discards a claim
      // about a person says which one (FF1's rule).
      if (chipMerge.legacyKeysDropped.length > 0) {
        console.log(
          `compose-blueprint user=${user.id} dropped pre-RA1 chip traits: ${chipMerge.legacyKeysDropped.join(", ")}`
        );
      }

      // ---------------------------------------------------------------
      // MN3 — the contrast lane. Everything here is gated four times over,
      // and the gates are checked in cheapest-first order so a normal week
      // costs one boolean.
      //
      // SCARCITY: contrast cards SHARE the one-new-pattern-per-week budget
      // and never add to it, so a week that already surfaced a pattern
      // makes no contrast at all. A person meets at most one new
      // observation about themselves in a week, whichever lane it came
      // from. (Chip traits keep their own separate counter, as they always
      // have — a different candidate lane by existing design.)
      if (contrastsEnabled && !result.appliedNewPattern) {
        try {
          const timeZone = (user.timezone as string) ?? "UTC";
          const asOf = localDateString(now, timeZone);

          // Vulnerable-day gating, inherited from the question engine's own
          // definition (get_daily_question's v_missed_yesterday and
          // v_mood_le2_either), not reinvented here.
          const [{ data: yesterdayCompletions }, { data: lowMoodRows }] = await Promise.all([
            admin.from("completions").select("id")
              .eq("user_id", user.id).eq("local_date", addDays(asOf, -1)).limit(1),
            admin.from("reflections").select("id")
              .eq("user_id", user.id).lte("mood", 2)
              .in("local_date", [addDays(asOf, -1), addDays(asOf, -2)]).limit(1),
          ]);

          const gate = contrastGate({
            enabled: contrastsEnabled,
            appliedNewPattern: result.appliedNewPattern,
            vulnerable: isVulnerableDay({
              missedYesterday: (yesterdayCompletions ?? []).length === 0,
              lowMoodRecently: (lowMoodRows ?? []).length > 0,
            }),
          });

          if (gate !== "ok") {
            summary.contrastsHeld++;
            console.log(`contrast held for user ${user.id}: ${gate}`);
          } else {
            const { data: candidateRows, error: detectError } = await admin
              .rpc("detect_contrast_candidates", { p_user: user.id, p_as_of: asOf });

            if (detectError) {
              // A detector that cannot run makes no claim, which is the
              // right failure. Reported, never swallowed (FF1's rule).
              console.error(`detect_contrast_candidates failed for user ${user.id}:`, detectError.message);
            } else {
              const candidates = (candidateRows ?? []) as ContrastFactSheet[];
              summary.contrastCandidates += candidates.length;

              if (candidates.length > 0) {
                const contrastPrompt = buildContrastPrompt(candidates);
                const contrastRes = await fetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: {
                    "x-api-key": anthropicApiKey,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    model: MODEL,
                    max_tokens: MAX_CONTRAST_TOKENS,
                    system: contrastPrompt.system,
                    messages: [{ role: "user", content: contrastPrompt.user }],
                  }),
                });

                if (!contrastRes.ok) {
                  const text = await contrastRes.text().catch(() => "");
                  console.error(`Anthropic contrast error ${contrastRes.status} for user ${user.id}: ${text}`);
                } else {
                  const contrastJson = await contrastRes.json();
                  summary.totalInputTokens += contrastJson?.usage?.input_tokens ?? 0;
                  summary.totalOutputTokens += contrastJson?.usage?.output_tokens ?? 0;

                  // Named apart from the synthesis proposal above on
                  // purpose: two different models' output in one scope is
                  // exactly how the wrong one gets validated.
                  const contrastProposal = parseContrastProposal(contrastJson?.content?.[0]?.text ?? "");
                  if (!contrastProposal) {
                    summary.contrastsDropped++;
                    console.error(`contrast card DROPPED for user ${user.id}: malformed`);
                  } else {
                    // THE GATE. A card that fails any clause is dropped and
                    // logged, never repaired and never regenerated toward
                    // compliance. A silent week is a fine outcome.
                    const verdict = validateContrastProposal(contrastProposal, candidates);
                    if (!verdict.ok) {
                      summary.contrastsDropped++;
                      console.error(`contrast card DROPPED for user ${user.id}: ${verdict.reason}`);
                    } else {
                      const contrastMerge = mergeContrastCard({
                        previous: result.content,
                        sheet: verdict.sheet,
                        proposal: contrastProposal,
                        nowIso,
                      });
                      result.content.contrasts = contrastMerge.contrasts;
                      if (contrastMerge.applied) {
                        summary.contrastsApplied++;
                      } else {
                        console.log(`contrast card not applied for user ${user.id}: ${contrastMerge.skipped}`);
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          // The contrast lane is additive: a failure here must never cost
          // someone their synthesis run.
          console.error(`contrast lane failed for user ${user.id}:`, e instanceof Error ? e.message : e);
        }
      }

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
      if (chipMerge.newTraitApplied) summary.chipTraitsApplied++;
    } catch (e) {
      console.error(`Unhandled error composing blueprint for user ${user.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
});
