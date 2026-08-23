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
// JOB 3 — THE COPY. **NOT RULED. NOT SHIPPED.**
// ─────────────────────────────────────────────────────────────────────
//
// Cat owns these words and has not seen them yet. The candidates are in
// the section handoff; the constant below exists ONLY so the tests and
// the type-checker have something to run against, and this function is
// NOT deployed. compose-nudges has not been redeployed with it, and it
// must not be until she rules.
//
// THE REGISTER, binding, from the section brief: this is their own lock
// screen, so quiet-day information is theirs to see; no shame words, no
// verdicts, no countdown dread; lowercase (LC1); never 🔥 (the no-flame
// law); TN1's "your place is being kept" family. It may say today
// matters; it may not say they failed.
//
// TWO CONSTRAINTS THE BUILD DISCOVERED, both real limits on what a
// candidate can say:
//
//  1. NO NUMBER IS AVAILABLE. The run at stake is 25-26 days in the
//     measured fixture, but get_glow_for_user returns glow = 0 on the
//     cliff branch and never publishes the run-before-the-break. A line
//     that quotes the number needs a new field first — costed in the
//     handoff, not built here.
//  2. THE HOLD MAY ONLY BE NAMED IF THE SHELTER GUARD STAYS. A line
//     about a pebble keeping their place is true only for someone
//     actually pebble-held; the follow-up migration excludes everyone
//     else for exactly that reason. A pure-invitation line would be
//     true for both, and would let that exclusion be lifted.

/** PLACEHOLDER — candidate A, pending Cat's ruling. Never deployed. */
export const CLIFF_NOTICE_COPY_UNRULED = {
  subject: "your place is still here",
  html:
    "<p>it's been a quiet few days — that's all it is.</p>" +
    "<p>one small thing today, and your rally picks up right where it left off.</p>" +
    '<p><a href="https://rally21.com">open Rally21</a></p>',
};
