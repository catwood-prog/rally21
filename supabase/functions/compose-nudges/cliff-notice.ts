// CV3 (23 Aug) — THE PERSON HEARS ONCE, ON CLIFF MORNING.
//
// Pure, portable logic only — no Deno imports — so this file is directly
// Jest-testable, the same split nudge-lines.ts and timing.ts already
// use. index.ts fetches the facts; this file decides.
//
// WHY THE ONE-NUDGE DECISION MOVED HERE. EM0's never-both rule is
// stated in index.ts as prose and enforced by a bare `continue` at the
// bottom of a 300-line branch. That is genuinely how it works, and it
// is also why nothing has ever tested it: index.ts calls `Deno.serve`
// at module load, so Jest cannot import it at all. Adding a THIRD kind
// to that chain without a test would have meant three mutually
// exclusive branches held apart by control flow alone.

/** The kinds that compete for the single automated nudge a person may
 * receive on one local day. Ordered by precedence below. */
export type DailyNudgeKind = "cliff_notice" | "ember_nudge" | "nudge_daily";

/**
 * WHICH ONE THING DO WE SAY TO THIS PERSON TODAY?
 *
 * The precedence is a warmth judgement, not an arbitrary order:
 *
 *   cliff_notice — today decides whether a long run survives, and it is
 *                  the last morning anything can be done about it. If
 *                  there is one sentence to spend, it is this one.
 *   ember_nudge  — the run has already broken but the road back is
 *                  still open. Live code, though never once enqueued
 *                  (CV3 job 1: zero rows, all time) because the branch
 *                  needs an UNSHELTERED break and real breaks are
 *                  cliffs.
 *   nudge_daily  — the ordinary day.
 *
 * They cannot in fact overlap today — an 'embers' state needs an
 * unsheltered break, which puts the last check-in far enough back that
 * the cliff window is closed — but "cannot overlap" is a property of
 * two other functions that a future edit to either could quietly end.
 * So the order is written down and tested rather than relied upon.
 */
export function selectDailyNudgeKind(facts: {
  /** public.cliff_window_for returned a row for this person today. */
  cliffWindowOpen: boolean;
  /** get_glow_for_user's current state, or null if it could not be read. */
  glowState: string | null | undefined;
  /** get_glow_for_user's missed_local_date — the ember nudge's dedupe
   * key needs it, so an embers state without one cannot be sent. */
  emberMissedLocalDate: string | null | undefined;
}): DailyNudgeKind {
  if (facts.cliffWindowOpen) return "cliff_notice";
  if (facts.glowState === "embers" && facts.emberMissedLocalDate) return "ember_nudge";
  return "nudge_daily";
}

// ─────────────────────────────────────────────────────────────────────
// JOB 3 — THE COPY. **RULED BY CAT, 23 Aug. Candidate C, verbatim.**
// ─────────────────────────────────────────────────────────────────────
//
// Ruled on all three surfaces at once and shipped exactly as ruled: no
// other candidate ships and no wording drifts. Candidates A and B are in
// the section handoff and are not in this file, deliberately — a
// rejected line kept next to a shipped one is the next session's
// accident.
//
// THE REGISTER IT WAS WRITTEN TO, binding and still binding on any
// future edit: this is their own lock screen, so quiet-day information
// is theirs to see; no shame words, no verdicts, no countdown dread;
// lowercase (LC1); never 🔥 (the no-flame law); TN1's "your place is
// being kept" family. It may say today matters; it may not say they
// failed. Candidate C says today matters twice and never once says
// anything about them.
//
// WHY THIS LINE IS TRUE, which is the part a future edit can break
// without noticing. "held for you" is a claim about the pebble shelter,
// and it is only true of somebody actually pebble-held — which is
// exactly what cliff_window_for's shelter guard guarantees (see
// migration 20260823121445). Cat ruled that guard STAYS on 23 Aug, and
// the two decisions are one decision: LOOSENING THE GUARD WOULD MAKE
// THIS SENTENCE A LIE for anyone whose run had already broken
// unsheltered.
//
// NO NUMBER APPEARS HERE and none can: get_glow_for_user returns
// glow = 0 on the cliff branch and never publishes the
// run-before-the-break, so the 25-26 days actually at stake are not
// available to this pipeline. Ledgered with the pen, not built.

/** Cat's ruled copy, 23 Aug. Three surfaces, one sentence family.
 *
 * `subject` is BOTH the email subject and the push TITLE; `pushBody` is
 * the lock-screen line (send-notifications prefers a composer's exact
 * push body over stripping the email html, NQ1's pattern); `html` is the
 * email body.
 *
 * The email closes on the app's shipped open-Rally21 link line — ruled in
 * by Cat on 23 Aug and reused VERBATIM from the ember ask email rather
 * than reworded, because every other email in the app ends on that exact
 * sentence and a second wording would be a second sentence to keep.
 * send-notifications appends its own unsubscribe footer besides. */
export const CLIFF_NOTICE_COPY = {
  subject: "today's the one that counts",
  pushBody: 'a few quiet days have been held for you. today keeps them.',
  html:
    '<p>a few quiet days have been held for you.</p>' +
    '<p>today is the one that keeps them held — nothing big, just one small thing.</p>' +
    '<p><a href="https://rally21.com">open Rally21</a></p>',
};
