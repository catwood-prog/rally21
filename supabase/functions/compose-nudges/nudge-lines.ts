// NQ1 (16 July) — the daily nudge's line pools + the deterministic
// no-repeat window + Cat's notification template, all pure so both the
// compose-nudges edge function (Deno) and the Jest suite can use them.
// This file has NO jsr/Deno imports on purpose: index.ts imports it as
// "./nudge-lines.ts" and the co-located Jest test imports it as
// "./nudge-lines" (same split as timing.ts / timing.test.ts).
//
// The pools below are the edge copy of constants/strings.ts's
// NUDGE_WARM_LINES / NUDGE_RESTART_LINES — this Deno file has no access
// to the client's module graph, so the two are hand-synced and pinned
// byte-identical by nudge-lines.test.ts. Source of the copy itself:
// ../../../../Rally21-Nudge-Copy-Draft.md (FINAL, Cat-approved 16 July).

export const WARM_LINES = [
  'just a reminder to check in with your circle.',
  "there's a warm spot for you in the circle — come take it.",
  "small and steady is the point, today's step can be tiny.",
  'keep up and you will be kept up.',
  "a couple of minutes, a couple of lines — that's all for today.",
  'your circle is quietly rooting for you, with no pressure attached.',
  "today's version of you only needs to do today's version of the thing.",
  'messy is most welcome here, showing up is what matters.',
  "it doesn't have to be perfect, it just has to be yours.",
  'the kettle takes longer to boil than this will.',
  "you don't need the perfect moment, this one will do.",
  'your future self is quietly cheering you on.',
  "the huddle's warmer with you in it.",
  "today's ask is small on purpose.",
  'one small yes is enough for today.',
  "penguins don't overthink the huddle. they just waddle in.",
  'a wobbly little effort is still a lovely effort.',
  "the little thing is little, that's the whole idea.",
  "you don't need to feel ready, just a couple of minutes is enough.",
  'the circle keeps a light on for you.',
  'a quiet little win is waiting for you.',
  'it fits in the gap between two scrolls.',
  'a friendly wave from us — your practice is ready when you are.',
  'your spot in the circle is always yours — come fill it today.',
  'little things have a lovely way of adding up.',
  'a couple of minutes can be its own little win.',
  'consider this a wave from across the room.',
  "you'll be glad you did it. you always are.",
  'five minutes from now, this could already be done.',
  "the hardest part is opening the app. you're basically there.",
  'done today beats perfect someday.',
];

// Restart-framed only — never references a miss. Used instead of a warm
// line when yesterday had no completion, so the copy never reads as guilt.
export const RESTART_LINES = [
  'day ones are always welcome, tonight is a fine time to begin again.',
  'any day is a good day to begin again.',
  'no catching up required — just a little something today.',
  "today is a clean page. that's all it needs to be.",
  'a fresh start, zero paperwork.',
  'beginning again is still a beginning.',
  'day one energy is good energy.',
  'no run-up needed, step in whenever you like.',
  "starting again is a skill — and you're already practicing it.",
  'clean page, small pen, plenty of possibility.',
  'a fresh start begins with one small check-in.',
  'today welcomes you just as you are — one small check-in starts it.',
];

// No-repeat window (NQ1, job 2). Warm: no warm line twice within this many
// calendar days. Restart: no restart line twice within this many of the
// user's most-recent RESTART days (restart-day count, not calendar days).
export const WARM_NO_REPEAT_DAYS = 10;
export const RESTART_NO_REPEAT_COUNT = 6;

// The reconstruction (below) replays every day forward from a FIXED epoch,
// not a sliding localDate-minus-N window. That matters: if each day started
// its reconstruction at its own localDate-minus-N, two adjacent days would
// disagree about the lines "sent" near their (differently-placed)
// boundaries, and a line could repeat across that seam. Anchoring every
// day's reconstruction at the same epoch makes the sent line for any given
// day globally well-defined, so the no-repeat window is a true invariant.
// The epoch is safely before any live user's first nudge (the app's first
// users appeared in July 2026); days before it never occur in production.
export const NUDGE_RECONSTRUCT_EPOCH = '2026-01-01';
// A hard cap so the forward replay can never be unbounded. Comfortably
// larger than the account age of the whole live cohort; only once an
// account is older than this does the boundary slide (and a rare seam
// repeat becomes possible again) — revisit before that matters.
export const MAX_RECONSTRUCT_DAYS = 500;

/** The date the forward reconstruction starts from for a given localDate:
 * the epoch, unless the account-agnostic cap pulls it forward, and never
 * after localDate itself. Exported so the composer's completions query
 * fetches exactly the span the reconstruction reads. */
export function reconstructStartDate(localDate: string): string {
  const capped = shiftDate(localDate, -MAX_RECONSTRUCT_DAYS);
  const start = capped > NUDGE_RECONSTRUCT_EPOCH ? capped : NUDGE_RECONSTRUCT_EPOCH;
  return start > localDate ? localDate : start;
}

// Cat's notification template (NQ1, job 4). One subject for every daily
// nudge; no emoji (her copy has none); "with your circle" is gone.
export const NUDGE_SUBJECT = 'A little nudge from Rally';

/** The same deterministic hash the pre-NQ1 `pick` used, so a day with no
 * window exclusions resolves to the identical line it always did. */
export function seededIndex(seedStr: string, mod: number): number {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  return seed % mod;
}

/** Shift a YYYY-MM-DD date by whole days in UTC (DST-proof, mirrors
 * lib/date.ts / the composer's own dayBefore). */
export function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate()
  ).padStart(2, '0')}`;
}

function pickExcluding(pool: string[], seedStr: string, excluded: Set<string>): string {
  const available = pool.filter((line) => !excluded.has(line));
  // Windows are always smaller than their pool (≤10 of 31 warm, ≤6 of 12
  // restart), so `available` is never empty — the fallback is defensive.
  const base = available.length > 0 ? available : pool;
  return base[seededIndex(seedStr, base.length)];
}

export type NudgeBranch = 'warm' | 'restart';

/**
 * Deterministic, storage-free daily-nudge line selection with the
 * no-repeat window (NQ1, jobs 1–3). Pure: the same userId + localDate +
 * completed-date set always yields the same line.
 *
 * It reconstructs the exact line SENT on every day from the fixed epoch
 * up to localDate by replaying this same windowed pick forward, honouring
 * each day's own window — so today's exclusion set is the real recent
 * lines, and the window is a true invariant (no recursion, no stored
 * state). A day's branch (warm vs restart) is derived purely from whether
 * the user completed the day before it. Because every call anchors at the
 * same epoch, all calls agree on every prior day's line.
 *
 * @param completedDates local dates (YYYY-MM-DD) with ≥1 completion, going
 *   back at least to reconstructStartDate(localDate) minus one day.
 */
export function selectNudgeLine(params: {
  userId: string;
  localDate: string;
  completedDates: Iterable<string>;
  warmLines?: string[];
  restartLines?: string[];
}): { line: string; branch: NudgeBranch } {
  const warm = params.warmLines ?? WARM_LINES;
  const restart = params.restartLines ?? RESTART_LINES;
  const completed = params.completedDates instanceof Set ? params.completedDates : new Set(params.completedDates);

  const missedYesterday = (d: string) => !completed.has(shiftDate(d, -1));
  const seedFor = (d: string) => `nudge-${params.userId}-${d}`;

  const sent: Record<string, string> = {};
  const branchOf: Record<string, NudgeBranch> = {};
  const restartDaysInOrder: string[] = [];

  let day = reconstructStartDate(params.localDate);
  // start..localDate inclusive, one day at a time. The iteration cap is
  // MAX_RECONSTRUCT_DAYS by construction of reconstructStartDate; +2 is a
  // purely defensive guard against a malformed localDate.
  for (let i = 0; i <= MAX_RECONSTRUCT_DAYS + 2; i++) {
    const branch: NudgeBranch = missedYesterday(day) ? 'restart' : 'warm';
    branchOf[day] = branch;

    let line: string;
    if (branch === 'warm') {
      const excluded = new Set<string>();
      for (let k = 1; k <= WARM_NO_REPEAT_DAYS; k++) {
        const prev = shiftDate(day, -k);
        if (branchOf[prev] === 'warm' && sent[prev]) excluded.add(sent[prev]);
      }
      line = pickExcluding(warm, seedFor(day), excluded);
    } else {
      const recent = restartDaysInOrder.slice(-RESTART_NO_REPEAT_COUNT);
      const excluded = new Set<string>();
      for (const rd of recent) if (sent[rd]) excluded.add(sent[rd]);
      line = pickExcluding(restart, seedFor(day), excluded);
      restartDaysInOrder.push(day);
    }

    sent[day] = line;
    if (day === params.localDate) return { line, branch };
    day = shiftDate(day, 1);
  }

  // Unreachable for a well-formed localDate; keep the type total.
  return { line: pickExcluding(warm, seedFor(params.localDate), new Set()), branch: 'warm' };
}

/** The sentence half of Cat's template body — lowercased practice names in
 * the app's house voice, no "with your circle", 1 / 2 / 3+ variants. */
export function nudgeSentence(practiceNames: string[]): string {
  const names = practiceNames.map((n) => n.toLowerCase());
  if (names.length <= 1) return `one small thing to do today: ${names[0] ?? 'your practice'}.`;
  if (names.length === 2) return `two small things to do today: ${names[0]}, ${names[1]}.`;
  return `a few small things to do today: ${names.join(', ')}.`;
}

/** The whole nudge_daily render (NQ1, job 4): one subject, a push body the
 * sender delivers verbatim, and the email html (leads with the same
 * sentence + line, then the open button; unsubscribe footer is appended by
 * send-notifications). */
export function renderNudge(
  practiceNames: string[],
  line: string
): { subject: string; pushBody: string; html: string } {
  const sentence = nudgeSentence(practiceNames);
  return {
    subject: NUDGE_SUBJECT,
    pushBody: `${sentence}\n${line}`,
    html: `<p>${sentence}</p>
<p>${line}</p>
<p><a href="https://rally21.com">open Rally21</a></p>`,
  };
}

// ---------------------------------------------------------------------------
// NQ2 (17 July) — "a line you loved": roughly weekly, deterministic per user,
// the daily nudge's warm-line slot serves back a share-card quote the user
// Liked. The whole decision layer sits ABOVE selectNudgeLine and never
// touches it: on a loved-line day the composer simply sends the rendered
// quote instead of the warm line selectNudgeLine chose. The NQ1 no-repeat
// reconstruction stays internally consistent (it replays what selectNudgeLine
// WOULD have said on every day, loved days included), and the "no warm line
// twice within 10 days" invariant still holds for actually-sent warm lines —
// the exclusion sets are a superset of what was really sent, never a subset.
// Restart days are deliberately untouched: a loved line must never displace
// the restart framing on a day after a miss — the section's slot is the
// WARM-line slot, by name.
// Phase 3 (cohort-loved lines) is deliberately NOT built — see DEFERRED.md.

export const LOVED_LINE_PREFIX = 'a line you loved: ';
/** Gate: only a user with a meaningful handful of likes ever gets a loved
 * line (floor confirmed against live data 17 July — like volume is tiny, one
 * user with 2 distinct likes, so nothing argued for a different floor). */
export const LOVED_LINE_MIN_LIKES = 3;
/** 1-in-7 day-hash, minus the consecutive-day exclusion below ⇒ each day has
 * a (1/7)·(6/7) ≈ 12% chance of being a loved-line day — roughly weekly
 * (one in ~8.2 days), deterministic per user, no stored state. */
export const LOVED_LINE_HASH_MOD = 7;
/** Cutoff for the WHOLE rendered push body (sentence + loved line), in
 * characters. send-notifications delivers payload.push_body verbatim — no
 * send-time truncation — so the composer enforces this itself. 220 keeps the
 * body inside what iOS/Android reliably display in the expanded notification
 * (roughly 4 lines) before the OS ellipsizes it mid-thought — the exact
 * failure the length rule exists to prevent. The APNs 4KB payload cap is
 * never the binding constraint; display truncation is. */
export const NUDGE_PUSH_BODY_MAX_CHARS = 220;

/** seededIndex with a murmur3-style avalanche finalizer. The loved-line
 * PICK needs this instead of plain seededIndex: the pick seed and the
 * day-gate seed share the same `${userId}-${localDate}` suffix, which makes
 * the two raw 31-multiplier hashes affinely related — conditioning on "the
 * gate fired" then skews the pick badly (measured: a 4-quote pool split
 * ~330/40/35/310 across loved days instead of ~180 each). The finalizer
 * breaks that relation; NQ1's seededIndex itself stays untouched because its
 * shipped line choices are pinned by the reconstruction invariant. */
export function mixedSeededIndex(seedStr: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  // ^ yields a SIGNED 32-bit value — normalize before the modulo or negative
  // hashes alias to index 0 (-0) and skew the pick.
  h = (h ^ (h >>> 16)) >>> 0;
  return h % mod;
}

/** Deterministic "is today a loved-line day for this user": the day-hash
 * fires ~1 day in 7, and a day whose PREVIOUS day also fired is excluded, so
 * two quote-nudges can never land on consecutive days — by construction, not
 * by stored state. */
export function isLovedLineDay(userId: string, localDate: string): boolean {
  const fires = (d: string) => seededIndex(`loved-${userId}-${d}`, LOVED_LINE_HASH_MOD) === 0;
  return fires(localDate) && !fires(shiftDate(localDate, -1));
}

/** One liked bank row, as the composer reads it (share_card_bank joined via
 * card_events.card_key = share_card_bank.id). */
export type LikedQuote = {
  cardKey: string;
  body: string;
  attribution: string | null;
  tier: string;
};

/** Same no-author-line rule as the cards (lib/shareCards.ts's
 * hasAttributionLine — hand-copied, this Deno file has no access to the
 * client's module graph): null AND the literal string 'Unknown' both mean
 * "render no author". */
function hasAuthorLine(attribution: string | null): boolean {
  return !!attribution && attribution !== 'Unknown';
}

/** The fully rendered loved line: prefix + the quote + the author line when
 * the bank row has one (PD 'Unknown'/null rows render none, same rule as the
 * cards; MV-tier rows always have one — enforced by eligibility below). */
export function renderLovedLine(quote: LikedQuote): string {
  const author = hasAuthorLine(quote.attribution) ? ` — ${quote.attribution}` : '';
  return `${LOVED_LINE_PREFIX}“${quote.body}”${author}`;
}

/**
 * The whole NQ2 decision for one user+day. Returns the loved line to send in
 * place of the warm line, or null for "plain pool today" (not a loved day,
 * restart branch, gate not met, or the picked quote too long for push).
 *
 * Eligibility (from the caller's already-mute-filtered liked rows): deduped
 * by cardKey, and an MV-tier (modern_voice_in_copyright) row without a
 * renderable author line is excluded outright — the rights posture is that
 * an MV quote ALWAYS carries its attribution wherever it renders, so one
 * that can't is never served (defensive: live data has zero such rows).
 * The pick is seeded per user+day over the cardKey-sorted eligible set, so
 * the same inputs always choose the same quote.
 *
 * Length rule: a quote whose fully rendered push body would exceed the
 * cutoff is SKIPPED for push — excluded from the pick, never truncated
 * mid-thought — and only when NO liked quote fits does the day fall back to
 * the plain pool. (Skipping only the picked quote was tried first and failed
 * the section's own "~weekly" verification: a like-set with a couple of long
 * quotes silently starved the cadence, with short loved quotes sitting right
 * there.) The fallback applies to the day as a whole — email and push always
 * carry the same body (the channel is a send-time decision the composer
 * can't know, so splitting content between them would break Cat's
 * one-template design).
 */
export function composeLovedNudge(params: {
  userId: string;
  localDate: string;
  branch: NudgeBranch;
  likedQuotes: LikedQuote[];
  practiceNames: string[];
}): { line: string; cardKey: string } | null {
  if (params.branch !== 'warm') return null;
  if (!isLovedLineDay(params.userId, params.localDate)) return null;

  const byKey = new Map<string, LikedQuote>();
  for (const q of params.likedQuotes) {
    if (q.tier === 'modern_voice_in_copyright' && !hasAuthorLine(q.attribution)) continue;
    if (!byKey.has(q.cardKey)) byKey.set(q.cardKey, q);
  }
  const eligible = [...byKey.values()].sort((a, b) => (a.cardKey < b.cardKey ? -1 : 1));
  // The floor is about the LIKES being a meaningful handful, so it's checked
  // before the length filter — three long likes still open the gate, they
  // just can't serve until one fits.
  if (eligible.length < LOVED_LINE_MIN_LIKES) return null;

  const fitting = eligible.filter(
    (q) => renderNudge(params.practiceNames, renderLovedLine(q)).pushBody.length <= NUDGE_PUSH_BODY_MAX_CHARS
  );
  if (fitting.length === 0) return null;

  const picked = fitting[mixedSeededIndex(`loved-pick-${params.userId}-${params.localDate}`, fitting.length)];
  return { line: renderLovedLine(picked), cardKey: picked.cardKey };
}
