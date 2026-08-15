/** MS1 — the one rule for reading a server-authored refusal.
 *
 * THE BUG THIS EXISTS TO END. `postgrest-js` (2.110.0, see
 * `PostgrestBuilder` in `dist/index.cjs`) only constructs a real
 * `PostgrestError` when `shouldThrowOnError` is set — and this app never
 * sets it (`throwOnError` appears nowhere in `app/`, `lib/` or
 * `supabase/`). Everywhere else it hands back `JSON.parse(body)`, a PLAIN
 * OBJECT. So `e instanceof Error` is FALSE for every PostgREST read,
 * write and RPC error in the codebase, and the `e instanceof Error ?
 * e.message : fallback` idiom discards the server's sentence unread.
 *
 * IL3 (10 Aug) found this on the invite-code path, where a FULL circle
 * told people to re-check a code that was never wrong. It fixed that one
 * line inline; MS1 made the rule shared.
 *
 * `P0001` IS THE WHOLE DISCIPLINE. It is Postgres's `raise_exception` —
 * the SQLSTATE for a hand-written `raise exception`, i.e. a sentence
 * somebody wrote for a person to read. Everything else keeps the caller's
 * own friendly fallback rather than putting raw Postgres on screen:
 * an RLS refusal is `42501`, a constraint is `23xxx`, and a timeout
 * arrives as a plain object whose message merely STARTS 'AbortError:'
 * (see `isRequestTimeout` in `lib/fetch-timeout.ts`) — none of them are
 * for reading.
 *
 * NOT EVERY `raise exception` QUALIFIES EITHER, and that is a judgement
 * the SQL author makes, not this function. Plenty of RPCs raise internal
 * markers — 'not authenticated', 'not signed in', 'founder only',
 * 'invalid target kind' — which are guarded client-side and would read as
 * gibberish on a screen. Those RPCs' call sites deliberately do NOT use
 * this helper, and `server-refusal-guard.test.ts` holds the list of which
 * RPCs raise nothing human, with a reason on each.
 *
 * THERE IS NO NEW COPY HERE, by design: every fallback passed in is the
 * string that call site already showed. This only stops the server's
 * better sentence being thrown away when there is one.
 */

/** The server's own sentence, or `null` when there isn't one.
 *
 * Returns the RAW extracted message rather than a resolved string,
 * because two screens need the text itself, not a display fallback:
 * `cover.tsx` (and `circle.tsx`'s gesture row) branch on it to pick warm
 * copy — 'your nest is empty' becomes `STRINGS.pebbleEmptyNestError`,
 * 'nudges disabled' becomes the opted-out line. A helper that only ever
 * returned a finished string could not revive those branches, which have
 * been dead for exactly as long as the `instanceof` has been false. */
export function serverRefusal(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const err = e as { code?: unknown; message?: unknown };
  if (err.code !== 'P0001') return null;
  return typeof err.message === 'string' && err.message ? err.message : null;
}

/** The server's sentence when it wrote one, else the caller's existing
 * friendly line. The common shape — most call sites want a string to put
 * straight into `setError`. */
export function serverRefusalOr(e: unknown, fallback: string): string {
  return serverRefusal(e) ?? fallback;
}
