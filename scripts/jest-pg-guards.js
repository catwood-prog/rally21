/**
 * HD1 job 2 (3 Aug) — run guards for the DB-bound suites.
 *
 * SCOPE: the suites matching `supabase/*.integration.test.ts` — 21 of them
 * as of 27 Aug, RE-DERIVED by GR1 from the glob itself. The count in this
 * line has now been stale four times running (14 on 10 Aug, 17 while there
 * were 18, and "19 as of 23 Aug" — which was already wrong the day it was
 * written: HT1's addaafb added the nineteenth and CV3's de87202 added the
 * twentieth the SAME 23 Aug; OB1's ecfb941 added the twenty-first on
 * 27 Aug). Do not trust this number, DERIVE it:
 * `ls supabase/*.integration.test.ts | wc -l`; that glob is the whole
 * population, no integration suite lives elsewhere in the repo.
 *
 * They open a direct Postgres
 * connection and hold ONE transaction for the whole file. Pointed at
 * production that is safe (every suite rolls back, nothing commits), but a
 * suite that wedges — a lock it can't take, a runaway statement, a hang
 * between assertions — would sit on live tables until someone noticed. So
 * every connection they open aborts itself rather than waiting:
 *
 *   lock_timeout                        5s
 *   statement_timeout                   30s
 *   idle_in_transaction_session_timeout 300s
 *
 * WHY THIS IS A PROTOTYPE PATCH AND NOT A CONNECTION STRING. The obvious
 * home for these is libpq's `options` startup parameter on the URL. That
 * works on a direct connection — and this project cannot use one: the
 * direct host (db.<ref>.supabase.co) publishes an AAAA record and no A
 * record, so it is unreachable from any IPv4-only network, which is what
 * the dev machine is behind. The working route is the SESSION pooler
 * (aws-0-us-east-1.pooler.supabase.com:5432, IPv4) — and Supavisor
 * silently DISCARDS `options`. Measured 3 Aug: a pooler connection carrying
 * all three settings came back lock_timeout=0, statement_timeout=2min,
 * idle_in_transaction_session_timeout=0. Silently, with no error — the
 * guards would have looked applied and been absent.
 *
 * Patching connect() is therefore the only placement that is verifiable
 * from inside the session, and it has the better property anyway: a future
 * DB-bound suite gets the guards without having to remember them.
 *
 * NOTE the pooler must stay in SESSION mode (port 5432). Transaction mode
 * (6543) would break these suites outright — they depend on one session
 * spanning many statements, `set local role`, and savepoints.
 */
/**
 * Every client currently connected, so scripts/jest-pg-isolation.js can
 * put a savepoint around each test. Populated here because this is the one
 * place that sees every `new Client(...).connect()` the suites make.
 */
const liveClients = new Set();

const GUARDS = [
  "set lock_timeout = '5s'",
  "set statement_timeout = '30s'",
  // RAISED 60s -> 300s (Cat's ruling, 26 Aug, from RE3's diagnosis; landed
  // by GR1, 27 Aug). The 60s ceiling was OURS, not the pooler's: for eleven
  // days the DB suites' "idle-in-transaction" FATALs were read as
  // Supavisor's doing, because the FATAL names `application_name:
  // Supavisor` and the pooler is what the connection goes through. It was
  // this line all along — the database's own default is 0, and the harness
  // is what SET a value.
  //
  // READ THE UNIT BEFORE CHANGING THIS NUMBER. It bounds the IDLE GAP —
  // how long a session sits inside an OPEN transaction between statements,
  // a clock Postgres resets on every statement. It is NOT a suite's total
  // runtime and NOT a test's. A busy suite round-tripping continuously
  // never approaches it however long it runs: measured 27 Aug on the first
  // run after this raise, re-ask-cycle took 361.8s and first-ask 358.9s,
  // both comfortably over this value, both green, because neither ever sat
  // still for five minutes.
  //
  // WHAT 60s ACTUALLY KILLED WAS NEIGHBOURS, and the unit above is why.
  // Jest runs these suites in PARALLEL (no maxWorkers set, so cores-1 = 7
  // here; measured on that same run, 1525.9s of suite time inside 362.3s
  // of wall clock, ~4.2x). Every worker holds its OWN connection inside
  // its OWN transaction. So while one long-but-legitimate test runs, the
  // other workers' connections are sitting idle mid-transaction, doing
  // nothing wrong — and at 60s the database shot them. One slow test
  // therefore reported as a spray of unrelated reds in other files.
  // 300s is exactly RE1's PER-TEST jest ceiling for the DB suites
  // (jest-pg-isolation.js's `jest.setTimeout(300000)` — per test, not per
  // suite), which is the longest a single legitimate test is allowed to
  // take, and therefore the longest a well-behaved neighbour can be forced
  // to idle. Matching the two is the point of the number.
  //
  // A genuinely frozen session still caps its hold on live tables at five
  // minutes — accepted at this cohort size, and these suites roll back and
  // commit nothing, so the guard is against a wedge sitting on production
  // tables, not against corruption.
  "set idle_in_transaction_session_timeout = '300s'",
];

/**
 * Called only from scripts/jest-pg-isolation.js, and only for an
 * `*.integration.test.ts` path. `pg` is required lazily in here rather than
 * at module scope on purpose: requiring it pulls in pg's SASL code, which
 * touches `TextEncoder` at import time, and that is undefined under the
 * jsdom test environment most of this repo's unit suites run in. Loading it
 * unconditionally took out lib/wakeLock.test.ts with a `TextEncoder is not
 * defined` suite-level failure that had nothing to do with the test.
 */
function installGuards() {
  const pg = require('pg');
  if (pg.Client.prototype.connect.__hd1Patched) return { liveClients };

  const originalConnect = pg.Client.prototype.connect;

  const patchedConnect = function patchedConnect(callback) {
  if (callback) {
    // Callback form — left unpatched deliberately rather than guessed at.
    // Every suite in this repo awaits connect(); if one ever uses the
    // callback form it must not silently lose its guards, so fail loudly.
    throw new Error(
      'jest-pg-guards: callback-style client.connect() is not supported — ' +
        'use `await client.connect()` so the run guards can be applied.'
    );
  }
    return originalConnect.call(this).then(async () => {
      for (const stmt of GUARDS) {
        await this.query(stmt);
      }
      liveClients.add(this);
    });
  };
  patchedConnect.__hd1Patched = true;
  pg.Client.prototype.connect = patchedConnect;

  const originalEnd = pg.Client.prototype.end;
  pg.Client.prototype.end = function patchedEnd(...args) {
    liveClients.delete(this);
    return originalEnd.apply(this, args);
  };

  return { liveClients };
}

module.exports = { installGuards, liveClients };
