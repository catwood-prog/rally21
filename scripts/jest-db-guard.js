/**
 * HD1 job 1 (3 Aug) — make the DB-bound skip LOUD.
 *
 * SCOPE OF THIS FILE'S COUNT: the suites matching
 * `supabase/*.integration.test.ts`, which is the whole population — no
 * integration suite lives anywhere else in the repo. There are 22
 * (re-derived from the glob 27 Aug by HT2, which added the
 * twenty-second). The number has gone stale
 * every time it has been written — 14 on 10 Aug, 17 while there were 18,
 * and 19 as of 23 Aug, which was wrong the same day (HT1's addaafb added
 * the nineteenth and CV3's de87202 the twentieth on 23 Aug; OB1's ecfb941
 * added the twenty-first on 27 Aug). A section that adds a suite is
 * supposed to update this line in the same change, and four misses say
 * that convention does not hold on its own. Recount with
 * `ls supabase/*.integration.test.ts | wc -l` rather than trusting the
 * number written here — INCLUDING the copy baked into the banner below,
 * which is what a human actually reads. GR1 left both as literals rather
 * than deriving the count at runtime, because that is a behaviour change
 * in a globalSetup path and was outside its fence; deriving it is the
 * standing recommendation.
 *
 * Those suites are the only tests
 * of the security conventions (function grants, RLS, the anon EXECUTE
 * posture), and they self-skip when SUPABASE_DB_URL is unset. Each one
 * already carried a `console.warn` for that case — and measuring it found
 * those warns print ZERO times: jest's default reporter only flushes a
 * suite's buffered console output when that suite reports test results, and
 * a fully-`describe.skip`'d file reports none. So the safety net could be
 * (and was, for a month) entirely absent from every run with no signal at
 * all beyond a "N skipped" count nobody reads.
 *
 * This module backs jest's `globalSetup` / `globalTeardown` (the two thin
 * wrappers beside it; see package.json). It writes straight to
 * process.stderr, outside jest's per-suite console capture, so the banner
 * cannot be swallowed — once before the first suite, once after the last,
 * so it survives a long scrollback and lands next to the summary a human
 * actually reads.
 *
 * Under CI_REQUIRE_DB=1 the missing URL is a HARD FAILURE instead: that is
 * the switch a CI job (or a session that means to prove the net ran) flips
 * so "the suites skipped" can never again be mistaken for "the suites
 * passed".
 */

const RULE = '='.repeat(72);

function banner(where) {
  const lines = [
    '',
    RULE,
    '  !!  SUPABASE_DB_URL IS NOT SET — 22 INTEGRATION SUITES DID NOT RUN',
    RULE,
    '  Skipped: every supabase/*.integration.test.ts suite. These are the',
    '  ONLY tests of the RLS policies, the function grants and the anon',
    '  EXECUTE posture. A green run without them proves nothing about',
    '  security — it proves the unit tests are green.',
    '',
    '  To run them, set the direct Postgres connection string (Supabase',
    '  dashboard -> Project Settings -> Database -> Connection string,',
    '  "URI" tab, DIRECT connection, not the pooler):',
    '',
    '      SUPABASE_DB_URL="postgresql://..." npm run test:ci',
    '',
    '  Every suite runs inside one transaction that is always rolled back,',
    '  so no row survives. Never commit the URL.',
    '',
    '  To make this a hard failure (CI, or a session proving the net ran):',
    '',
    '      CI_REQUIRE_DB=1 npm run test:ci',
    RULE,
    `  (${where})`,
    RULE,
    '',
  ];
  process.stderr.write(lines.join('\n') + '\n');
}

/**
 * @param {'setup'|'teardown'} phase — only `setup` may abort the run; a
 *   throw from teardown would mask whatever the suites actually reported.
 */
function guard(phase) {
  if (process.env.SUPABASE_DB_URL) return;

  if (process.env.CI_REQUIRE_DB === '1') {
    if (phase === 'setup') {
      throw new Error(
        'CI_REQUIRE_DB=1 but SUPABASE_DB_URL is not set — the 22 ' +
          'supabase/*.integration.test.ts suites (RLS, function grants, ' +
          'anon EXECUTE) would silently skip. Refusing to run a test pass ' +
          'that cannot see the database.'
      );
    }
    return;
  }

  banner(
    phase === 'setup'
      ? 'before the run'
      : 'after the run — this is what the "skipped" count above means'
  );
}

module.exports = { guard, banner };
