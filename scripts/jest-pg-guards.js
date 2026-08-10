/**
 * HD1 job 2 (3 Aug) — run guards for the DB-bound suites.
 *
 * SCOPE: the suites matching `supabase/*.integration.test.ts` — 17 of them
 * as of 10 Aug (EL1; was 14 and went stale silently). Recount with
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
 *   idle_in_transaction_session_timeout 60s
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
  "set idle_in_transaction_session_timeout = '60s'",
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
