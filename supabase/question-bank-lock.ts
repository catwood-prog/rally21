/**
 * RE2 (8 August 2026) — one suite at a time on the shared question bank.
 *
 * THE DEFECT. `public.questions` is a SHARED MUTABLE FIXTURE: three DB-bound
 * suites write to it inside their own transaction — re-ask-cycle's control arm
 * (`set reask_tracked = false` across the tracked set, held for the ~86s of a
 * doubled 90-day replay), first-ask's struck-question test (archives HAB-15),
 * and question-arc's retire tests (archive SELF-12 / VAL-09 / FU-07). They run
 * under jest's normal workers, so two of them can hold and want the same row at
 * the same time, and the loser dies at `lock_timeout = 5s` with
 *
 *     error: canceling statement due to lock timeout
 *
 * ...thrown from pg/lib/client.js:652, which then poisons that suite's
 * transaction until HD1's per-test `rollback to savepoint` clears it. RE1 found
 * this on 6 Aug and correctly left it: it stayed latent through both of its
 * post-fix net runs by luck, and every real fix costs something a test author
 * should not choose alone.
 *
 * WHY NARROWING THE WRITES DOES NOT FIX IT. first-ask's seeded question IS
 * HAB-15 and question-arc's is SELF-12, and both are inside re-ask-cycle's
 * tracked set — so the suites contend for the same rows however tight the WHERE
 * clause gets. Narrowing is still worth doing (it takes the sweep from every row
 * in the bank down to the six tracked ones, which lifts VAL-09 and FU-07 out of
 * the collision entirely) but it is a smaller blast radius, not a fix.
 *
 * WHAT THIS IS INSTEAD. A mutex on the fixture, held for the whole of any test
 * that writes to the bank: the writes then queue instead of racing, and no
 * statement ever waits on a row lock it can lose. It is a targeted version of
 * "serialise the DB suites" that charges wall-clock only to the handful of tests
 * that actually share the bank, rather than to every DB suite on every run
 * forever (measured 8 Aug: 373s parallel against ~1152s of DB-suite work).
 *
 * WHY pg_try_advisory_lock IN A POLL RATHER THAN pg_advisory_lock. The blocking
 * form WAITS on a lock, so `lock_timeout = 5s` would abort it and we would have
 * rebuilt the defect one level up. `pg_try_advisory_lock` returns immediately
 * with a boolean and takes no lock it does not get, so the guard never fires and
 * NOTHING about it is relaxed — this is deliberately not RE2's option (b), which
 * is Cat's ruling and not a session's.
 *
 * THE THREE PROPERTIES IT LEANS ON, measured against the live pooler on 8 Aug
 * rather than assumed: the lock is exclusive across two sessions; it SURVIVES
 * `rollback to savepoint`, so the release below has to be explicit; and
 * `pg_advisory_unlock_all()` clears it, which is the belt-and-braces release
 * scripts/jest-pg-isolation.js now runs at every test boundary in case a test is
 * abandoned mid-hold.
 *
 * A future suite that writes to `public.questions` and does NOT come through
 * here is unprotected, in both directions. This is the only sanctioned way to
 * write to the bank from a test.
 */
import type { Client } from 'pg';

/** Two-int form, so `pg_locks` shows a greppable (21, 1) rather than a hash. */
const LOCK_CLASS = 21;
const LOCK_KEY = 1;

const POLL_MS = 150;

/**
 * Generous, because the legitimate wait is a neighbour's whole test: the
 * longest holder is re-ask-cycle's control arm at 68-86s measured. Still well
 * inside the 300s per-test ceiling, so a suite that trips this deadline has hit
 * something real (a leaked hold, a wedged neighbour) and should say so loudly
 * rather than fail as a lock timeout again.
 */
const DEADLINE_MS = 180_000;

/** Nested inside HD1's per-test `jest_test_boundary`, never a replacement for it. */
const HOLD = 'question_bank_hold';

/**
 * Run `body` holding the question-bank mutex. Wrap the WHOLE region that writes
 * to the bank, not just the UPDATE: a row lock lives until the end of the
 * (sub)transaction that took it, so releasing after the write would release
 * nothing that matters.
 *
 * The hold is bracketed by its own savepoint, and the mutex is handed on only
 * after that savepoint is rolled back — measured 8 Aug, `rollback to savepoint`
 * DOES release the row locks taken after it, so this is what closes the window
 * where the next suite could hold the mutex and still lose the row race. It also
 * means the bank is restored whether `body` succeeds or throws, and that a
 * throw which poisoned the transaction is un-poisoned in time for the unlock.
 * Anything `body` created is fixture rows that HD1's afterEach would have thrown
 * away moments later anyway, so nothing survivable is lost by rolling back here.
 */
export async function withQuestionBank<T>(
  client: Client,
  what: string,
  body: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const { rows } = await client.query('select pg_try_advisory_lock($1, $2) as got', [
      LOCK_CLASS,
      LOCK_KEY,
    ]);
    if (rows[0].got) break;
    if (Date.now() - started > DEADLINE_MS) {
      throw new Error(
        `[question-bank] ${what} waited ${DEADLINE_MS / 1000}s for the shared question ` +
          'bank and never got it. Another DB suite is holding it — see ' +
          'supabase/question-bank-lock.ts.'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  const waited = Date.now() - started;
  if (waited >= 1000) {
    // Not noise: this is the line that says the mutex earned its keep on this
    // run, and how much wall-clock it cost. Silence means no suites overlapped.
    console.log(`[question-bank] ${what} waited ${(waited / 1000).toFixed(1)}s for the bank`);
  }

  await client.query(`savepoint ${HOLD}`);
  try {
    return await body();
  } finally {
    try {
      await client.query(`rollback to savepoint ${HOLD}`);
      await client.query(`release savepoint ${HOLD}`);
      await client.query('select pg_advisory_unlock($1, $2)', [LOCK_CLASS, LOCK_KEY]);
    } catch {
      // Deliberately swallowed rather than masking whatever `body` threw with a
      // second failure. jest-pg-isolation.js's afterEach rolls back to the
      // per-test savepoint and then runs pg_advisory_unlock_all(), so both the
      // row locks and the mutex are still released at the test boundary.
    }
  }
}
