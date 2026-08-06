/**
 * RA1 — the re-ask cycle, pinned where it actually runs.
 *
 * Same reasoning as question-arc.integration.test.ts: the cycle is a
 * `where q.reask_tracked and la.last_ask <= p_local_date - 30` inside
 * get_daily_question, and that is deliberately the only place it exists. A
 * TypeScript copy of the rule would be a second source of truth for the
 * same question — the drift class this project has already paid for twice.
 * So due-ness, the window exemption, the caps and job 4's dates are all
 * asserted against the real function.
 *
 * get_daily_question branches on auth.uid(), which reads the
 * `request.jwt.claim.sub` GUC — only a real signed JWT or a direct,
 * privileged Postgres connection can set it. See "Running the RPC-boundary
 * integration tests" in CLAUDE.md. Everything runs inside one transaction,
 * always rolled back in afterAll, so it never leaves a row behind whatever
 * it asserts — including the reask_tracked flips below.
 */
import { createHash } from 'crypto';
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  console.warn(
    '[re-ask-cycle.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

/** Cat's ruling, 31 July: "CS1's five, exactly." Asserted against the
 * column rather than assumed, so changing the set in the bank without
 * meaning to fails here.
 *
 * AMENDED by MN3 the same night (HAB-15 joined the set, as the declared
 * side of the one contrast mapping) and caught by FA1 on 1 August: this
 * constant still said five while the live bank held six, so this suite
 * would have failed the moment anyone set SUPABASE_DB_URL. It had been
 * skipping, which is exactly how a red test stays quiet. */
const TRACKED = ['CON-10', 'ENR-09', 'HAB-15', 'MOOD-09', 'SELF-12', 'STR-03'];

/** Cat's second ruling, same session: "~30 days". */
const CYCLE_DAYS = 30;

/** A seeded practice, so the replay's circle is a real one. */
const SEEDED_PRACTICE_KEY = 'meditate';

describeIfConfigured('RA1 — the re-ask cycle', () => {
  let client: Client;
  let practiceId: string;

  const BASE = '2026-06-01';

  function dayOf(n: number): string {
    const d = new Date(`${BASE}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + (n - 1));
    return d.toISOString().slice(0, 10);
  }

  async function actAs(userId: string) {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
  }

  /** RE1, 6 August — THE TESTER'S UUID WAS THIS SUITE'S HIDDEN RANDOM SEED,
   * and it is the root cause of the flake this file was ledgered for since
   * 4 August. get_daily_question breaks its ordering ties on
   * `md5(v_user || p_local_date || q.id)`, so the user id CHOOSES the
   * question sequence — and `crypto.randomUUID()` drew a fresh one per
   * tester, per test, per run. Every hedge in the comments below ("a
   * different tester means different md5 tie-breaks", "a seed that loses a
   * weekend to the L2 cap slips a whole week") is that randomness being
   * apologised for.
   *
   * Measured 6 Aug, replaying the same 90 days against pinned uuids: the
   * outcome is a pure function of the seed (identical across repeats), and
   * 3 of 40 seeds left HAB-15 one ask short — which is exactly the
   * `Expected: >= 3 / Received: 2` the ledger recorded, alternating between
   * lines 207 and 275 because those two tests each drew their OWN tester.
   *
   * So the ids are derived from a counter instead. Same sequence every run,
   * distinct within a run, and a failure is now reproducible by re-running
   * rather than by waiting for it to come round again. NOTE the ordering
   * dependency this buys: inserting a new test that builds a tester shifts
   * every later tester's id, which is a deterministic change in fixture but
   * a change nonetheless — re-run the suite after adding one. */
  let testerSeq = 0;
  function nextTesterId(): string {
    testerSeq += 1;
    const h = createHash('md5').update(`re1-tester-${testerSeq}`).digest('hex');
    const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
    return [
      h.slice(0, 8),
      h.slice(8, 12),
      `4${h.slice(13, 16)}`,
      `${variant}${h.slice(17, 20)}`,
      h.slice(20, 32),
    ].join('-');
  }

  /** A user in a circle that started on day 1 — the replay needs the
   * membership because `v_missed_yesterday` reads completions, and a user
   * with no completions at all looks like someone who misses every day. */
  async function createTester(): Promise<string> {
    const id = nextTesterId();
    await client.query('insert into auth.users (id) values ($1)', [id]);
    const { rows } = await client.query(
      `insert into public.circles (name, invite_code, start_date, practice_id)
       values ('ra1 test', substr(md5(random()::text), 1, 6), $1::date, $2) returning id`,
      [dayOf(1), practiceId]
    );
    await client.query('insert into public.memberships (circle_id, user_id) values ($1, $2)', [
      rows[0].id,
      id,
    ]);
    await client.query("select set_config('ra1.circle', $1, true)", [rows[0].id]);
    await actAs(id);
    return id;
  }

  /** Serve one day, answer it, and check in — the way a tester who never
   * skips does. Returns the question code actually served. */
  async function liveOneDay(userId: string, n: number): Promise<string> {
    await client.query('select * from public.get_daily_question($1::date)', [dayOf(n)]);
    await client.query(
      `update public.reflections set question_answer = $3, mood = 4
        where user_id = $1 and local_date = $2::date`,
      [userId, dayOf(n), `answer for day ${n}`]
    );
    await client.query(
      `insert into public.completions (user_id, circle_id, local_date, kind)
       values ($1, current_setting('ra1.circle')::uuid, $2::date, 'self')`,
      [userId, dayOf(n)]
    );
    const { rows } = await client.query(
      `select q.code from public.reflections r
         join public.questions q on q.id = r.question_id
        where r.user_id = $1 and r.local_date = $2::date`,
      [userId, dayOf(n)]
    );
    return rows[0]?.code ?? null;
  }

  async function livePerfectTester(through: number): Promise<{ id: string; codes: string[] }> {
    const id = await createTester();
    const codes: string[] = [];
    for (let n = 1; n <= through; n += 1) codes.push(await liveOneDay(id, n));
    return { id, codes };
  }

  /** Which day-numbers each tracked question was served on. */
  async function trackedAskDays(userId: string): Promise<Map<string, number[]>> {
    const { rows } = await client.query(
      `select q.code, array_agg(r.local_date - $2::date + 1 order by r.local_date) as days
         from public.reflections r
         join public.questions q on q.id = r.question_id
        where r.user_id = $1 and q.reask_tracked
        group by q.code`,
      [userId, BASE]
    );
    return new Map(rows.map((r: any) => [r.code, r.days.map(Number)]));
  }

  /** THE 90-DAY FLOOR IS A POOL-SCOPED CLAIM, not a flat one (RE1, 6 Aug).
   *
   * A tracked question on `pool = 'any'` can be re-asked the day its 30-day
   * cycle comes due, so its third ask lands around day 62-76 — comfortably
   * inside MN3's window. A tracked question on `pool = 'weekend'` cannot:
   * a cycle that comes due on a Monday waits for Saturday, which makes its
   * real period 34-35 days rather than 30. Three asks therefore need
   * ~20 + 35 + 35 = day 90 AT BEST, and the ordinary pool's competition for
   * the same weekend L2 slot pushes it to 97 whenever it bites.
   *
   * Measured 6 Aug across 24 seeds replayed to day 126: every `any`-pool
   * tracked question reached three asks by day 76; the weekend one landed
   * its third between day 90 and day 97. So "every tracked question reaches
   * three asks inside 90 days" was never true of the product — it was true
   * of most seeds, by a margin of zero days, which is precisely why it read
   * as a flake instead of as a wrong assertion.
   *
   * Read from the column rather than hard-coded, for FA1's reason: a test
   * pinned to a live figure is the lesson this file has already paid for. */
  async function trackedPools(): Promise<Map<string, string>> {
    const { rows } = await client.query(
      'select code, pool from public.questions where reask_tracked'
    );
    return new Map(rows.map((r: any) => [r.code, r.pool]));
  }

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    await client.query('BEGIN');
    const { rows } = await client.query('select id from public.practices where key = $1', [
      SEEDED_PRACTICE_KEY,
    ]);
    practiceId = rows[0].id;
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  test("the tracked set is Cat's five and nothing else", async () => {
    const { rows } = await client.query(
      'select code from public.questions where reask_tracked order by code'
    );
    expect(rows.map((r: any) => r.code)).toEqual(TRACKED);
  });

  describe('JOB 1 — due, not due, and the exemption', () => {
    test('a tracked question is NOT re-asked before the cycle is up', async () => {
      const { id } = await livePerfectTester(CYCLE_DAYS + 1);
      const days = await trackedAskDays(id);
      // MOOD-09 is the arc's day 2, so day 31 is only 29 days later.
      expect(days.get('MOOD-09')).toEqual([2]);
    });

    test('it IS re-asked once the cycle is up, and that beats the 30-day repeat window', async () => {
      const { id } = await livePerfectTester(CYCLE_DAYS + 3);
      const days = await trackedAskDays(id);
      // Day 32 is exactly 30 days after day 2. Nothing else in the engine
      // may serve a question answered inside 30 days — this branch is the
      // single exemption, which is what makes the second answer possible.
      expect(days.get('MOOD-09')).toEqual([2, 32]);
    });

    test('a re-ask REPLACES the day rather than adding to it', async () => {
      const { id, codes } = await livePerfectTester(CYCLE_DAYS + 3);
      expect(codes[31]).toBe('MOOD-09');
      const { rows } = await client.query(
        'select count(*)::int as n from public.reflections where user_id = $1',
        [id]
      );
      // One row per day, still — 33 days lived, 33 reflections.
      expect(rows[0].n).toBe(CYCLE_DAYS + 3);
    });

    test('nothing is re-served inside 30 days — the cycle asks AT the window, never through it', async () => {
      // Worth stating precisely, because "the pool never repeats" is not
      // true and never was: once the 30-day exclusion expires an untracked
      // question can come round again by chance, and over 90 days most of
      // the bank does (measured 31 July: ~27 codes twice each). What no
      // question may do — tracked or not — is arrive with less than 30 days
      // between asks.
      const { id } = await livePerfectTester(90);
      const { rows } = await client.query(
        `select q.code, r.local_date
             - lag(r.local_date) over (partition by q.code order by r.local_date) as gap
           from public.reflections r
           join public.questions q on q.id = r.question_id
          where r.user_id = $1`,
        [id]
      );
      for (const row of rows) {
        if (row.gap !== null) expect(Number(row.gap)).toBeGreaterThanOrEqual(CYCLE_DAYS);
      }
    });

    test('the cycle is what delivers a third answer — chance does not', async () => {
      // The claim RA1 exists to make, stated as a controlled comparison
      // rather than as a sequence diff (a different tester means different
      // md5 tie-breaks, so the sequences legitimately differ).
      const pools = await trackedPools();
      const withCycle = await trackedAskDays((await livePerfectTester(90)).id);
      // Scoped to the `any` pool — see trackedPools above. The weekend-pool
      // question's third ask lands day 90-97, so asserting it here was the
      // coin flip; its ceiling is pinned by the JOB 4 test instead. The
      // control arm below stays unscoped, because with the cycle switched
      // off NOTHING reaches three, weekend pool included (measured 6 Aug:
      // max 2 asks per tracked code across 24 seeds replayed to day 126).
      const anyPool = TRACKED.filter((code) => pools.get(code) === 'any');
      expect(anyPool.length).toBeGreaterThan(0);
      for (const code of anyPool) {
        expect((withCycle.get(code) ?? []).length).toBeGreaterThanOrEqual(3);
      }

      await client.query('update public.questions set reask_tracked = false');
      try {
        const { id } = await livePerfectTester(90);
        const { rows } = await client.query(
          `select q.code, count(*)::int as n
             from public.reflections r
             join public.questions q on q.id = r.question_id
            where r.user_id = $1 and q.code = any($2::text[])
            group by q.code`,
          [id, TRACKED]
        );
        // Pre-RA1 the same five got one ask each from the arc and, at best,
        // a lucky second later on. Never three. That was MN3's blocker.
        for (const row of rows) expect(row.n).toBeLessThan(3);
      } finally {
        await client.query(
          `update public.questions
              set reask_tracked = coalesce(code = any($1::text[]), false)`,
          [TRACKED]
        );
      }
    });

    test("inside MN3's 90-day window, only a tracked question reaches three asks", async () => {
      // Scoped to 90 days on purpose, and the scope is the claim. MN3's
      // floor is "3 answers per family per 90 DAYS", and inside that window
      // chance cannot produce three asks of one question — the 30-day
      // exclusion plus a ~120-question pool makes even two unlikely. Run
      // the same replay to day 120 and chance does start to manage three
      // (measured 31 July: CON-01, CON-06, CON-09, MOT-06, VAL-09). So the
      // honest claim is not "only tracked questions ever repeat" — it is
      // that only tracked questions repeat ON A SCHEDULE, inside the window
      // MN3 actually asks about, on a date that can be named in advance.
      // HD2 job 3, 4 Aug — REWRITTEN, because the old assertion was the
      // coincidence and not the claim. It read "no UNTRACKED question
      // reaches three asks inside 90 days" and passed on 31 July only
      // because the pool happened to be sparse enough; a replay on 4 Aug
      // has CON-05 reaching three (days 23, 58, 89). Nothing regressed —
      // FA1 (31 July) made HAB-15 a sixth tracked question, which tightens
      // the pool and pulls the chance-repeat threshold in from ~120 days to
      // inside 90. And the gap spacing cannot distinguish the two cases
      // anyway: the 30-day exclusion FORCES every repeat to be >=30 apart,
      // so a chance triple and a scheduled one look identical from here.
      //
      // So this now asserts the thing RA1 actually guarantees, which is
      // what the paragraph above always said it was: every tracked
      // question reaches MN3's floor of three asks ON A SCHEDULE, inside
      // the window MN3 asks about. A test pinned to a live figure is the
      // known lesson (FA1's "tracked set 5 vs live 6"), so the tracked set
      // is read from the database rather than hard-coded.
      const { id } = await livePerfectTester(90);
      const { rows } = await client.query(
        `select q.code, count(*)::int as n
           from public.reflections r
           join public.questions q on q.id = r.question_id
          where r.user_id = $1 and q.reask_tracked
          group by q.code`,
        [id]
      );
      const { rows: tracked } = await client.query(
        'select code from public.questions where reask_tracked order by code'
      );

      expect(rows.map((r: any) => r.code).sort()).toEqual(tracked.map((r: any) => r.code));

      // RE1, 6 Aug — POOL-SCOPED, and the scope is now part of the claim.
      // This assertion is where the ledgered flake fired (line 275, and its
      // twin at 207): it read "every tracked question reaches three asks in
      // 90 days", which the weekend-pool question meets on day 90 exactly or
      // not at all. See trackedPools above for the measurement. The honest
      // statement is per pool — and the weekend one's own floor is asserted
      // right below it, so nothing is quietly dropped from the suite.
      const pools = await trackedPools();
      for (const row of rows) {
        if (pools.get(row.code) === 'any') {
          expect(row.n).toBeGreaterThanOrEqual(3);
        } else {
          // It IS on the schedule and it IS being re-asked — two asks by day
          // 90 is the weekend pool's cost, not a stalled cycle. The third is
          // pinned by the JOB 4 test's day-105 ceiling.
          expect(row.n).toBeGreaterThanOrEqual(2);
        }
      }
    });

    test('same user, same date, same question — the cycle is deterministic across a re-pick', async () => {
      const id = await createTester();
      const first: string[] = [];
      for (let n = 1; n <= 35; n += 1) first.push(await liveOneDay(id, n));

      await client.query('delete from public.completions where user_id = $1', [id]);
      await client.query('delete from public.reflections where user_id = $1', [id]);
      await client.query('delete from public.question_dimension_rests where user_id = $1', [id]);

      const second: string[] = [];
      for (let n = 1; n <= 35; n += 1) second.push(await liveOneDay(id, n));

      expect(second).toEqual(first);
    });
  });

  describe('JOB 1 — the caps still bind', () => {
    test('no day ever carries 3 prior L2s and an L2 re-ask on top', async () => {
      const { id } = await livePerfectTester(90);
      const { rows } = await client.query(
        `select r.local_date - $2::date + 1 as day, q.code, q.depth,
                q.is_followup_template, q.reask_tracked,
                (select count(*)::int from public.reflections r2
                   join public.questions q2 on q2.id = r2.question_id
                  where r2.user_id = r.user_id and q2.depth = 'L2'
                    and r2.local_date >= r.local_date - 6
                    and r2.local_date < r.local_date) as prior_l2
           from public.reflections r
           join public.questions q on q.id = r.question_id
          where r.user_id = $1
          order by r.local_date`,
        [id, BASE]
      );

      const breaks = rows.filter((r: any) => r.depth === 'L2' && r.prior_l2 >= 3);
      // THE ONE KNOWN BREAK IS NOT RA1'S, and pinning it is the point.
      // Day 14 hands over to the follow-up branch, which has never enforced
      // the depth cap and whose templates are all L2 — CS1 recorded that
      // exception in its migration header and Cat ruled ship-as-is. It
      // appears identically with the cycle switched off (verified 31 July),
      // so RA1 neither causes nor worsens it. If a second break ever shows
      // up, or this one moves, this test is where it surfaces.
      expect(breaks.map((b: any) => `day ${b.day} ${b.code}`)).toEqual(['day 14 FU-07']);
      expect(breaks[0].is_followup_template).toBe(true);
      expect(breaks[0].reask_tracked).toBe(false);
    });

    test('a struck tracked question is not re-asked, and the day still gets a question', async () => {
      await client.query("update public.questions set is_archived = true where code = 'MOOD-09'");
      try {
        const id = await createTester();
        const codes: string[] = [];
        // Days 1-13 skip MOOD-09 via CS1's fall-through; day 32 must not
        // resurrect it either.
        for (let n = 1; n <= CYCLE_DAYS + 3; n += 1) codes.push(await liveOneDay(id, n));
        expect(codes).not.toContain('MOOD-09');
        expect(codes.every((c) => !!c)).toBe(true);
      } finally {
        await client.query("update public.questions set is_archived = false where code = 'MOOD-09'");
      }
    });

    test('a rested dimension suppresses its re-ask rather than overriding the rest', async () => {
      const { id } = await livePerfectTester(CYCLE_DAYS + 1);
      await client.query(
        `insert into public.question_dimension_rests (user_id, dimension, rested_until)
         values ($1, 'MOOD', $2::date)
         on conflict (user_id, dimension) do update set rested_until = excluded.rested_until`,
        [id, dayOf(CYCLE_DAYS + 10)]
      );
      const day32 = await liveOneDay(id, CYCLE_DAYS + 2);
      expect(day32).not.toBe('MOOD-09');
    });
  });

  describe('JOB 4 — the MN3 unlock, stated as a date', () => {
    test('every tracked family reaches 3 answers, and the last one lands by day 105', async () => {
      // FA1 moved this ceiling, and the reason is the point. RA1's five are
      // all pool = 'any', so their third ask lands a shade after two cycles
      // (measured 31 July: MOOD-09 64, ENR-09 66, SELF-12 69, STR-03 71,
      // CON-10 73). HAB-15 is weekend-only, so every one of its asks has to
      // wait for a Saturday or Sunday: a 30-day cycle from a Saturday comes
      // due on a Monday and is served the following Saturday, which makes
      // its real period 34-35 days, not 30. Measured under FA1 on this base
      // date: days 20, 55, 90. The binding constraint on Cat's tone review
      // is therefore HAB-15, and it is about three weeks later than the
      // rest of the set.
      const { id } = await livePerfectTester(105);
      const days = await trackedAskDays(id);

      for (const code of TRACKED) {
        const asks = days.get(code) ?? [];
        expect(asks.length).toBeGreaterThanOrEqual(3);
      }

      const thirds = TRACKED.map((code) => (days.get(code) ?? [])[2]);
      // A ceiling with headroom, not the measured five — a different tester
      // draws different md5 tie-breaks, and a seed that loses a weekend to
      // the L2 cap slips a whole week rather than a day. What this catches
      // is a change that pushes the unlock out by a month.
      expect(Math.max(...thirds)).toBeLessThanOrEqual(105);
      expect(Math.min(...thirds)).toBeGreaterThanOrEqual(CYCLE_DAYS * 2);
    });

    test("the ask budget stays small: a tracked question is never asked twice inside a cycle", async () => {
      const { id } = await livePerfectTester(90);
      const days = await trackedAskDays(id);
      for (const [, asks] of days) {
        for (let i = 1; i < asks.length; i += 1) {
          expect(asks[i] - asks[i - 1]).toBeGreaterThanOrEqual(CYCLE_DAYS);
        }
      }
      const totalReasks = [...days.values()].reduce((sum, a) => sum + a.length, 0);
      // SIX families since MN3, at most three asks each per 90 days — job
      // 2's budget, restated. Measured under FA1: exactly 18, i.e. one day
      // in five carries a tracked question and the other four are the
      // ordinary engine, untouched.
      expect(totalReasks).toBeLessThanOrEqual(18);
    });
  });
});
