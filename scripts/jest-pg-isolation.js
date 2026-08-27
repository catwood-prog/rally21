/**
 * HD1 job 2 (3 Aug) — per-test savepoints for the DB-bound suites.
 *
 * THE DEFECT THIS CLOSES, which is why the 14 suites had never produced a
 * usable result. Each suite opens ONE transaction in beforeAll and rolls it
 * back in afterAll (that is what makes them safe against production). But a
 * great many of their assertions are `expect(...).rejects` — proving an RPC
 * or an RLS policy REFUSES something. In Postgres a failed statement poisons
 * the whole transaction: every subsequent command returns
 *
 *     current transaction is aborted, commands ignored until end of
 *     transaction block
 *
 * ...until someone rolls back to a savepoint. Only 2 of the 14 suites
 * (edit-circle, cf1-flow-invariants) ever did. So in the other 12, the FIRST
 * successful proof-of-refusal silently destroyed every test after it — and
 * because the first test genuinely passed, the file reported a plausible mix
 * of passes and failures rather than an obvious harness error. Measured on
 * the first real run, 3 Aug: caps 4 of 5 red this way, security-hardening 31
 * of 34, cover-a-friend 8 of 10, rally-milestone 2 of 12.
 *
 * WHY HERE RATHER THAN IN EACH SUITE. The per-suite fix is edit-circle's
 * `rollback to savepoint` idiom repeated at ~40 call sites across 12 files —
 * mechanical, easy to get subtly wrong, and it only protects the sites
 * someone remembered. A savepoint around EVERY test protects the next suite
 * too, and it buys real test isolation as a side effect: a test's fixture
 * rows no longer leak into its neighbours, which they previously did for the
 * whole length of a file.
 *
 * WHAT IT DOES NOT CHANGE. The outer transaction and its afterAll ROLLBACK
 * are untouched, so the never-leaves-a-row property that makes these suites
 * safe against production is exactly as before. beforeAll fixtures are also
 * untouched: the savepoint is taken after beforeAll has run, so rolling back
 * to it preserves anything beforeAll created.
 */
/* global expect, jest, beforeEach, afterEach */
// eslint's flat config here carries no jest globals (which is also where 37
// of jest.setup.js's pre-existing errors come from). Declaring them for this
// file only, rather than adding them to eslint.config.js — that one-line
// config change would clear those 37 too, but it moves the legacy-error
// baseline while Cat's baseline-or-scope decision is still open.
const { installGuards, liveClients } = require('./jest-pg-guards');

const SAVEPOINT = 'jest_test_boundary';

const IS_DB_SUITE = /\.integration\.test\.[tj]s$/.test(
  expect.getState().testPath || ''
);

if (IS_DB_SUITE) installGuards();

/**
 * The second reason these suites had never produced a usable result: jest's
 * default per-test timeout is 5s, and several of them build 30-90 simulated
 * days of history one round trip at a time (re-ask-cycle's
 * livePerfectTester(90), first-ask's 30, share-card-cadence's 8-day loop).
 * Against a remote pooled connection that is comfortably more than 5s of
 * pure latency, so the tests aborted mid-fixture and reported a timeout
 * rather than an assertion — measured 3 Aug: re-ask-cycle 12 of 13 red this
 * way, first-ask 13 of 15, share-card-cadence 4 of 5.
 *
 * Raised only for the DB-bound suites: a unit test that hangs should still
 * fail in 5s rather than tie up a run for two minutes.
 *
 * RAISED AGAIN TO 300s BY RE1 (6 Aug), because 120s was still inside the
 * suites' real working range and that is the SECOND of the two mechanisms
 * behind the re-ask-cycle flake. re-ask-cycle's "the cycle is what delivers
 * a third answer" test replays 90 simulated days TWICE for its controlled
 * comparison — 720 round trips to a pooled remote database, measured at
 * 68-86s across ten isolation runs. The margin to 120s was under 2x, and a
 * routine latency excursion eats it: on the run that failed, a probe against
 * the same pooler showed the round trip going 350ms -> 3820ms with DNS
 * healthy, and the test came in at 124.6s.
 *
 * WHAT THE TIMEOUT THEN COSTS, which is why it looked connection-level for
 * four sittings. Jest abandons the timed-out test but its in-flight query is
 * still on the wire, so the afterEach `rollback to savepoint` below queues
 * BEHIND the abandoned work and the shared transaction stays poisoned. The
 * NEXT test dies with `current transaction is aborted, commands ignored
 * until end of transaction block` — thrown from pg/lib/client.js:652, the
 * very frame the ledger had been reading as `read ETIMEDOUT`. One slow test
 * therefore fails two, and neither failure names the slowness that caused
 * it. THAT CASCADE IS NOT FIXED HERE, only made much harder to reach: a
 * DB-bound test that genuinely times out will still take its neighbour with
 * it. The guards in jest-pg-guards.js still bound the pathological cases
 * (statement_timeout 30s, idle_in_transaction_session_timeout 300s since
 * GR1, 27 Aug — read that file's comment for why it was raised from 60s).
 * THE IDLE GUARD AND THIS CEILING ARE NOW THE SAME NUMBER, and that is
 * deliberate rather than a collision: they measure different things, so
 * neither pre-empts the other. This ceiling is per-TEST wall clock; the
 * idle guard bounds how long a connection sits inside an open transaction
 * between statements. Because jest runs these suites in parallel, a
 * worker idling mid-transaction while some OTHER worker's long test runs
 * is the common case — so setting the idle bound to exactly this ceiling
 * says "a neighbour may idle for as long as the longest test we permit",
 * which is what stops the idle guard killing innocent connections.
 * statement_timeout's 30s remains the guard that catches a runaway
 * single statement first.
 */
if (IS_DB_SUITE) {
  jest.setTimeout(300000);
}

// A client that is connected but NOT inside a transaction (or one already
// torn down) will reject these — that is expected and not a failure, so it
// is swallowed deliberately rather than left to fail the test it wraps.
// Nothing is hidden by doing so: if the savepoint never got taken, the
// rollback is a no-op and the suite behaves exactly as it did before.
async function tryOnEach(sql) {
  for (const client of liveClients) {
    try {
      await client.query(sql);
    } catch {
      /* not in a transaction, or the connection is gone — see above */
    }
  }
}

if (IS_DB_SUITE) {
  beforeEach(async () => {
    await tryOnEach(`savepoint ${SAVEPOINT}`);
  });

  afterEach(async () => {
    // `rollback to savepoint` both undoes the test's writes AND clears an
    // aborted-transaction state, which is the half that was missing.
    await tryOnEach(`rollback to savepoint ${SAVEPOINT}`);
    await tryOnEach(`release savepoint ${SAVEPOINT}`);
    // RE2 (8 Aug) — the release of last resort for supabase/question-bank-lock.ts.
    // A SESSION-level advisory lock outlives both an aborted statement and the
    // `rollback to savepoint` above (measured, not assumed), so a test abandoned
    // mid-hold — the jest-timeout path described above is exactly that — would
    // otherwise leave every other bank-writing suite polling until its deadline.
    // It runs AFTER the rollback because a poisoned transaction cannot execute
    // it. No suite takes an advisory lock for any other purpose, so releasing
    // all of them at a test boundary is exact rather than a broad sweep.
    await tryOnEach('select pg_advisory_unlock_all()');
  });
}
