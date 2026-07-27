/** SUP1 — the deadline every Supabase request was missing.
 *
 * supabase-js ships NO default timeout. Today and the circle tab both
 * end their load in `finally { setIsLoading(false) }`, so every failure
 * RESOLVES — but a request that never returns never reaches the finally
 * at all, and the screen spins forever. OD1 job 12a fixed the case where
 * a load FAILS; this is the case where it never FINISHES.
 *
 * It lives at the client level (one wrapper around the client's `fetch`),
 * never per screen — there are 20+ load paths and a per-screen timeout is
 * 20+ places to forget one.
 *
 * WHAT IT DOES NOT COVER, said plainly: realtime runs over a WebSocket,
 * not fetch, so it is untouched by this (it has its own heartbeat and
 * reconnect). And the deadline is cleared when the response promise
 * settles, which is when the FULL body has arrived on native (RN's fetch
 * is whatwg-fetch over XHR, which does not stream) but only when the
 * HEADERS have arrived on web. That is deliberate: it is the same
 * boundary postgrest-js's own built-in `db.timeout` option uses, and a
 * hang in practice is a request that never answers, not one that answers
 * and then stalls mid-body.
 */

/** The ceiling for API traffic — PostgREST reads and writes, RPCs, auth,
 * and edge functions. Every screen load in the app is made of these.
 *
 * WHY 15s. Measured against the live project on 26 July: a warm REST
 * round trip runs a 115ms median, and a cold one (fresh TLS connection,
 * the closest desktop analogue to a phone waking its radio) peaked at
 * 970ms. Modelling a genuinely bad mobile connection — 300-750ms RTT, a
 * ~2 RTT TLS 1.3 handshake, and a few KB of JSON — puts a slow-but-real
 * request at roughly 2-3s, call it 5s for the worst honest case. 15s is
 * ~3x that headroom and ~130x the measured median, so a slow phone on
 * bad signal is not punished. It is also about the point past which a
 * person has already decided the app is broken, so waiting longer buys
 * a worse experience rather than a better one. The asymmetry is
 * deliberate: failing a request that would have succeeded punishes
 * exactly the user this app cares about, so the margin is generous.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/** The ceiling for Storage object traffic, which is the avatar upload and
 * nothing else.
 *
 * WHY IT IS DIFFERENT. A single number cannot serve both jobs honestly.
 * The native upload path sends the picker's `allowsEditing` crop at
 * quality 0.7 with no resize (lib/profile.ts) — call it up to ~1.5MB. At
 * a poor-but-working 25kB/s upstream that is ~60s of legitimate transfer,
 * so a 15s ceiling would BREAK photo upload on bad signal: a regression
 * this change would have introduced, in the exact scenario job 1 says not
 * to punish. 60s matches iOS URLSession's own default request timeout, so
 * we are not stricter than the platform would have been with no timeout
 * at all, while still bounding a true hang.
 *
 * This can never cause a spinner on Today or the circle tab: no screen's
 * load path touches Storage. Avatars render from a public URL through a
 * plain <Image>, and `getPublicUrl` is a synchronous string build with no
 * request behind it — the only Storage calls in the app are the
 * user-initiated upload/list/remove in lib/profile.ts.
 */
export const STORAGE_TIMEOUT_MS = 60_000;

export function timeoutForUrl(url: string): number {
  return url.includes('/storage/v1/') ? STORAGE_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  const asRequest = input as Request;
  return typeof asRequest.url === 'string' ? asRequest.url : String(input);
}

function callerSignalOf(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  if (init?.signal) return init.signal;
  // `init.signal` overrides a Request's own signal when both are present,
  // so a Request-shaped input needs reading directly or a caller's
  // cancellation would be silently dropped on the floor.
  if (typeof input === 'object') return (input as Request).signal ?? null;
  return null;
}

/** Wraps a fetch implementation so every request carries a deadline.
 * Takes the implementation as an argument rather than reaching for the
 * global, so the behaviour is testable without a real client (the same
 * dependency-injection pattern as `resolveCircleSelection`'s `deps`). */
export function withRequestTimeout(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => {
    // A caller's own cancellation still has to win — postgrest's
    // `.abortSignal()` and storage's `signal` parameter both arrive this
    // way. If it has ALREADY fired there is nothing to time: hand the
    // request straight through untouched and let the platform raise its
    // own AbortError, rather than scheduling a deadline for a request
    // that is over before it starts.
    const callerSignal = callerSignalOf(input, init);
    if (callerSignal?.aborted) return fetchImpl(input, init);

    const ms = timeoutForUrl(urlOf(input));
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);

    const onCallerAbort = () => controller.abort();
    callerSignal?.addEventListener('abort', onCallerAbort);

    return fetchImpl(input, { ...init, signal: controller.signal })
      .catch((e: unknown) => {
        if (!timedOut) throw e;
        // Named AbortError ON PURPOSE. postgrest-js short-circuits its
        // retry loop the moment it sees that name, so one deadline can
        // never quietly become three. The message is for logs only —
        // every screen catches this and shows ER1's warm line, never a
        // raw message (warmth law).
        const timeout = new Error(`Supabase request timed out after ${ms}ms`);
        timeout.name = 'AbortError';
        throw timeout;
      })
      .finally(() => {
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', onCallerAbort);
      });
  };
}
