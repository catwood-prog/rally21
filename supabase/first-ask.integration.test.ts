/**
 * FA1 — the first ask, pinned where it actually runs.
 *
 * Cat's ruling, 31 July, in session: "SEED-ONCE, arc sealed."
 *
 * RA1 required `la.last_ask is not null`, so a tracked question that had
 * never been asked could never become due. HAB-15 — the declared side of
 * MN3's one contrast mapping — had therefore never been served to anybody,
 * and MN3's detector was correct and permanently silent. FA1 lets a null
 * anchor count as due, once, and sorts it first.
 *
 * The whole mechanism is two tokens inside one select in
 * get_daily_question (`is null` in the predicate, `nulls first` in the
 * ORDER BY), which is deliberately the only place it exists. So the same
 * reasoning as re-ask-cycle.integration.test.ts applies: a TypeScript copy
 * of the rule would be a second source of truth for the same question.
 * Everything below is asserted against the real function.
 *
 * get_daily_question branches on auth.uid(), which reads the
 * `request.jwt.claim.sub` GUC — only a real signed JWT or a direct,
 * privileged Postgres connection can set it. See "Running the RPC-boundary
 * integration tests" in CLAUDE.md. Everything runs inside one transaction,
 * always rolled back in afterAll, so it never leaves a row behind.
 */
import { createHash } from 'crypto';

import { Client } from 'pg';

import { withQuestionBank } from './question-bank-lock';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  console.warn(
    '[first-ask.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

/** Cat's ruling via MN3, 31 July: CS1's five arc declarations plus HAB-15. */
const TRACKED = ['CON-10', 'ENR-09', 'HAB-15', 'MOOD-09', 'SELF-12', 'STR-03'];

/** The one weekend-pool tracked question, and the reason FA1 exists. */
const SEEDED = 'HAB-15';

/** RA1's cycle, unchanged by FA1 — the first ask anchors it. */
const CYCLE_DAYS = 30;

const SEEDED_PRACTICE_KEY = 'meditate';

describeIfConfigured('FA1 — the first ask', () => {
  let client: Client;
  let practiceId: string;

  /** A Monday, so the arc's 14 days end mid-week and the first post-arc
   * weekend is a real wait rather than an accident of the base date. */
  const BASE = '2026-06-01';

  function dayOf(n: number): string {
    const d = new Date(`${BASE}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + (n - 1));
    return d.toISOString().slice(0, 10);
  }

  function isWeekend(n: number): boolean {
    const d = new Date(`${dayOf(n)}T00:00:00Z`);
    return d.getUTCDay() === 0 || d.getUTCDay() === 6;
  }

  async function actAs(userId: string) {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
  }

  /** RE1's M1, SECOND HOME — closed here by RE2 on 8 Aug.
   *
   * `get_daily_question` breaks its ordering ties on `md5(v_user ||
   * p_local_date || q.id)`, so the tester's uuid CHOOSES the question sequence.
   * RE1 root-caused that on 6 Aug and derived re-ask-cycle's ids from a counter
   * — but this sibling suite, which runs the identical 90/105-day walks against
   * the identical bank, kept drawing `crypto.randomUUID()`, so it kept
   * reseeding itself every run. Both of its HAB-15 floor assertions have since
   * failed in the wild on that lottery, `Expected: >= 3 / Received: 2`, once at
   * each site (QP1's net run, 8 Aug small hours; WC1's, the same day) — the
   * SAME assertion in two places, which is why the fix had to be the seed and
   * not either bound. A loosened bound would have hidden a real product
   * question rather than answered it.
   *
   * So the ids come from a counter, exactly as re-ask-cycle's do: same sequence
   * every run, distinct within a run, and a failure is reproducible by
   * re-running instead of by waiting for it to come round again. NOTE the
   * ordering dependency that buys — inserting a test that builds a tester
   * shifts every later tester's id, a deterministic change in fixture but a
   * change nonetheless. Re-run the suite after adding one.
   *
   * WHAT IT DOES NOT SETTLE, and must not be read as settling. The weekend pool
   * stretches HAB-15's cycle to a real 34-35 days, so its third ask lands late:
   * RE1 measured 3 of 40 seeds one ask short at day 90, and the two failures
   * above are 105-day walks, so some seeds fall short at 105 too — a rate nobody
   * has measured. Pinning the seed makes this SUITE honest and repeatable; it
   * does nothing for the real users whose own uuid draws one of those sequences,
   * and the pinned ids below are not evidence that the floor is met in general.
   *
   * CAT'S HAB-15 RULING LANDED 8 Aug and OD2 job S built it (migration
   * 20260809182553): MN3's declared window is now DERIVED from the cycle and
   * the pool — 105 days for `pool = 'weekend'`, still 90 for `pool = 'any'` —
   * and HAB-15 STAYS weekend, the move to `pool = 'any'` having been
   * considered and ruled against. That settles the WINDOW, and nothing else:
   * the paragraph above still stands, because how fast a given user's own md5
   * sequence delivers three asks is a different question and is still
   * unmeasured. */
  let testerSeq = 0;
  function nextTesterId(): string {
    testerSeq += 1;
    const h = createHash('md5').update(`fa1-tester-${testerSeq}`).digest('hex');
    const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
    return [
      h.slice(0, 8),
      h.slice(8, 12),
      `4${h.slice(13, 16)}`,
      `${variant}${h.slice(17, 20)}`,
      h.slice(20, 32),
    ].join('-');
  }

  async function createTester(): Promise<string> {
    const id = nextTesterId();
    await client.query('insert into auth.users (id) values ($1)', [id]);
    const { rows } = await client.query(
      `insert into public.circles (name, invite_code, start_date, practice_id)
       values ('fa1 test', substr(md5(random()::text), 1, 6), $1::date, $2) returning id`,
      [dayOf(1), practiceId]
    );
    await client.query('insert into public.memberships (circle_id, user_id) values ($1, $2)', [
      rows[0].id,
      id,
    ]);
    await client.query("select set_config('fa1.circle', $1, true)", [rows[0].id]);
    await actAs(id);
    return id;
  }

  /** Serve one day, answer it, check in. Returns the code actually served. */
  async function liveOneDay(userId: string, n: number, skip = false): Promise<string> {
    await client.query('select * from public.get_daily_question($1::date)', [dayOf(n)]);
    if (skip) {
      await client.query(
        `update public.reflections set question_skipped = true, question_answer = null, mood = 4
          where user_id = $1 and local_date = $2::date`,
        [userId, dayOf(n)]
      );
    } else {
      await client.query(
        `update public.reflections set question_answer = $3, mood = 4
          where user_id = $1 and local_date = $2::date`,
        [userId, dayOf(n), `answer for day ${n}`]
      );
    }
    await client.query(
      `insert into public.completions (user_id, circle_id, local_date, kind)
       values ($1, current_setting('fa1.circle')::uuid, $2::date, 'self')`,
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

  /** Which day-numbers a given code was served on. */
  function askDays(codes: string[], code: string): number[] {
    return codes.map((c, i) => (c === code ? i + 1 : 0)).filter((n) => n > 0);
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

  test('the tracked set is the six MN3 left behind', async () => {
    const { rows } = await client.query(
      'select code from public.questions where reask_tracked order by code'
    );
    expect(rows.map((r: any) => r.code)).toEqual(TRACKED);
  });

  describe('the defect FA1 closes', () => {
    test('HAB-15 is the only weekend-pool tracked question — which is why chance never reached it', async () => {
      const { rows } = await client.query(
        `select code, pool, depth from public.questions
          where reask_tracked and pool = 'weekend'`
      );
      expect(rows.map((r: any) => r.code)).toEqual([SEEDED]);
      expect(rows[0].depth).toBe('L2');
    });
  });

  describe('JOB 1 — seed-once: due, once, and anchored', () => {
    test('a never-asked tracked question IS served, and lands on the first post-arc weekend', async () => {
      const { codes } = await livePerfectTester(30);
      const days = askDays(codes, SEEDED);

      // Measured 31 July against the patched function on this base date:
      // the arc owns days 1-14, day 15 is a Monday, and the seed waits for
      // day 20 (Saturday). The assertion is the LAW, not the number — a
      // different tester draws different md5 tie-breaks.
      expect(days.length).toBeGreaterThanOrEqual(1);
      expect(days[0]).toBeGreaterThan(14);
      expect(isWeekend(days[0])).toBe(true);
    });

    test('the pool law holds: a weekend question never lands on a weekday', async () => {
      const { codes } = await livePerfectTester(90);
      for (const day of askDays(codes, SEEDED)) {
        expect(isWeekend(day)).toBe(true);
      }
    });

    test('it is served exactly ONCE — the second ask is the cycle, not another seed', async () => {
      const { codes } = await livePerfectTester(90);
      const days = askDays(codes, SEEDED);
      for (let i = 1; i < days.length; i += 1) {
        expect(days[i] - days[i - 1]).toBeGreaterThanOrEqual(CYCLE_DAYS);
      }
    });

    test('a SKIPPED first ask still anchors the cycle — silence is an answer, not a reason to nag', async () => {
      // The property that makes seed-once safe under the warmth law. RA1
      // anchors on the ASK, not the answer; if FA1 had anchored on the
      // answer, a skipped first ask would leave last_ask null and the
      // question would come back the very next weekend, forever.
      const id = await createTester();
      const codes: string[] = [];
      let seededOn = 0;
      for (let n = 1; n <= 40; n += 1) {
        // The seed cannot be predicted by day number, so it is served
        // normally and then rewritten to a skip the moment it appears.
        const code = await liveOneDay(id, n);
        codes.push(code);
        if (code === SEEDED && seededOn === 0) {
          seededOn = n;
          await client.query(
            `update public.reflections set question_skipped = true, question_answer = null
              where user_id = $1 and local_date = $2::date`,
            [id, dayOf(n)]
          );
        }
      }
      expect(seededOn).toBeGreaterThan(0);
      const days = askDays(codes, SEEDED);
      expect(days[0]).toBe(seededOn);
      // Not the next day, not the next weekend — a full cycle away.
      if (days.length > 1) expect(days[1] - days[0]).toBeGreaterThanOrEqual(CYCLE_DAYS);
    });

    test('the RA1 cycle anchors to the seeded ask and delivers a third', async () => {
      const { codes } = await livePerfectTester(105);
      const days = askDays(codes, SEEDED);
      expect(days.length).toBeGreaterThanOrEqual(3);
      expect(days[1] - days[0]).toBeGreaterThanOrEqual(CYCLE_DAYS);
      expect(days[2] - days[1]).toBeGreaterThanOrEqual(CYCLE_DAYS);
    });
  });

  describe('JOB 1 — the arc stays sealed, and the caps still bind', () => {
    test("CS1's arc is byte-identical: FA1 changes nothing before day 15", async () => {
      // The determinism half of Cat's ruling. Seed-once lives in the
      // post-arc branch only, so a user still inside the arc — five of the
      // six live accounts on 31 July — sees exactly the sequence CS1
      // replay-verified.
      const { codes } = await livePerfectTester(14);
      expect(codes.slice(0, 13)).toEqual([
        'ENR-01',
        'MOOD-09',
        'HAB-01',
        'ENR-09',
        'CON-01',
        'MOT-06',
        'CON-09',
        'STR-05',
        'SELF-12',
        'STR-03',
        'SELF-11',
        'CON-10',
        'VAL-05',
      ]);
      expect(codes).not.toContain(SEEDED);
    });

    test('the L2 cap blocks a seed rather than being overridden by it', async () => {
      const { id } = await livePerfectTester(90);
      const { rows } = await client.query(
        `select r.local_date - $2::date + 1 as day, q.code, q.is_followup_template,
                (select count(*)::int from public.reflections r2
                   join public.questions q2 on q2.id = r2.question_id
                  where r2.user_id = r.user_id and q2.depth = 'L2'
                    and r2.local_date >= r.local_date - 6
                    and r2.local_date < r.local_date) as prior_l2
           from public.reflections r
           join public.questions q on q.id = r.question_id
          where r.user_id = $1 and q.depth = 'L2'`,
        [id, BASE]
      );
      const breaks = rows.filter((r: any) => r.prior_l2 >= 3);
      // The one known break is CS1's follow-up branch on day 14, recorded
      // in its migration header and ruled ship-as-is. FA1 adds none: the
      // seed sits inside the same predicate the cap lives in.
      expect(breaks.map((b: any) => `day ${b.day} ${b.code}`)).toEqual(['day 14 FU-07']);
      expect(breaks[0].is_followup_template).toBe(true);
    });

    test('a cap-blocked seed is NOT consumed — it fires on the next day that allows it', async () => {
      // The property that makes "once" safe: due-ness is derived from a
      // null that does not move, so a blocked seed is postponed, never
      // spent. Forced rather than waited for — three L2 days are written
      // directly into the window before the first post-arc weekend.
      const id = await createTester();
      for (let n = 1; n <= 16; n += 1) await liveOneDay(id, n);

      const { rows: fillers } = await client.query(
        `select q.id from public.questions q
          where q.depth = 'L2' and q.pool = 'any' and not q.is_archived
            and not q.is_followup_template and q.code is not null and not q.reask_tracked
            and not exists (select 1 from public.reflections r
                             where r.user_id = $1 and r.question_id = q.id)
          order by q.code limit 3`,
        [id]
      );
      expect(fillers).toHaveLength(3);
      for (let i = 0; i < 3; i += 1) {
        await client.query(
          `insert into public.reflections (user_id, local_date, question_id,
                                           question_prompt_snapshot, question_skipped,
                                           question_answer, mood)
           values ($1, $2::date, $3, 'forced', false, 'a', 4)`,
          [id, dayOf(17 + i), fillers[i].id]
        );
        await client.query(
          `insert into public.completions (user_id, circle_id, local_date, kind)
           values ($1, current_setting('fa1.circle')::uuid, $2::date, 'self')`,
          [id, dayOf(17 + i)]
        );
      }

      const codes: string[] = [];
      for (let n = 20; n <= 45; n += 1) codes.push(await liveOneDay(id, n));

      // Day 20 is the Saturday the seed would have taken. The cap owns it.
      expect(codes[0]).not.toBe(SEEDED);
      // But it is not lost: it arrives on a later weekend, still exactly once.
      const served = codes.map((c, i) => (c === SEEDED ? i + 20 : 0)).filter((n) => n > 0);
      expect(served.length).toBeGreaterThanOrEqual(1);
      expect(isWeekend(served[0])).toBe(true);
      expect(served[0]).toBeGreaterThan(20);
    });

    test('a struck tracked question is never seeded, and the day still gets a question', async () => {
      // RE2, 8 Aug — M3, and THIS IS THE STATEMENT THAT DIED. HAB-15 is inside
      // re-ask-cycle's tracked set, so while that suite's control arm holds the
      // bank this archive waits on a row it cannot have and is cancelled at
      // `lock_timeout = 5s`. Reproduced on purpose 8 Aug, both with a stand-in
      // holder and with the two real suites overlapped on a pg_locks trigger:
      // failed in 5.4s, `canceling statement due to lock timeout`, while
      // re-ask-cycle itself passed 13/13. It takes its turn now.
      await withQuestionBank(client, 'first-ask: HAB-15 struck', async () => {
        await client.query(
          `update public.questions set is_archived = true where code = '${SEEDED}'`
        );
        try {
          const id = await createTester();
          const codes: string[] = [];
          for (let n = 1; n <= 30; n += 1) codes.push(await liveOneDay(id, n));
          expect(codes).not.toContain(SEEDED);
          expect(codes.every((c) => !!c)).toBe(true);
        } finally {
          await client.query(
            `update public.questions set is_archived = false where code = '${SEEDED}'`
          );
        }
      });
    });

    test('a rested dimension suppresses the seed rather than overriding the rest', async () => {
      const id = await createTester();
      for (let n = 1; n <= 16; n += 1) await liveOneDay(id, n);
      await client.query(
        `insert into public.question_dimension_rests (user_id, dimension, rested_until)
         values ($1, 'HAB', $2::date)
         on conflict (user_id, dimension) do update set rested_until = excluded.rested_until`,
        [id, dayOf(40)]
      );
      const codes: string[] = [];
      for (let n = 17; n <= 30; n += 1) codes.push(await liveOneDay(id, n));
      expect(codes).not.toContain(SEEDED);
    });

    test('no day is ever left blank by the change', async () => {
      const { id } = await livePerfectTester(90);
      const { rows } = await client.query(
        `select count(*)::int as n from public.reflections
          where user_id = $1 and question_id is null`,
        [id]
      );
      expect(rows[0].n).toBe(0);
    });
  });

  describe("JOB 3 — the unlock MN3's detector was waiting for", () => {
    test('a seeded, thrice-answered declaration makes a real contrast card possible', async () => {
      // The end-to-end claim, and the reason FA1 exists at all: MN3
      // shipped a detector that could never fire because its declared side
      // could never be collected. This walks a person who says the same
      // directional thing three times while their behaviour disagrees, and
      // asserts the detector goes from silent to one candidate on the day
      // the third answer lands — not before.
      const id = await createTester();
      const codes: string[] = [];
      for (let n = 1; n <= 105; n += 1) {
        await client.query('select * from public.get_daily_question($1::date)', [dayOf(n)]);
        const { rows } = await client.query(
          `select q.code from public.reflections r
             join public.questions q on q.id = r.question_id
            where r.user_id = $1 and r.local_date = $2::date`,
          [id, dayOf(n)]
        );
        const code = rows[0]?.code ?? null;
        codes.push(code);
        await client.query(
          `update public.reflections set question_answer = $3, mood = 4
            where user_id = $1 and local_date = $2::date`,
          [id, dayOf(n), code === SEEDED ? 'protect it' : 'a']
        );
        // Checks in on weekdays only, so the number disagrees with the words.
        if (!isWeekend(n)) {
          await client.query(
            `insert into public.completions (user_id, circle_id, local_date, kind)
             values ($1, current_setting('fa1.circle')::uuid, $2::date, 'self')`,
            [id, dayOf(n)]
          );
        }
      }

      const days = askDays(codes, SEEDED);
      expect(days.length).toBeGreaterThanOrEqual(3);
      const thirdAsk = days[2];

      const before = await client.query(
        'select count(*)::int as n from public.detect_contrast_candidates($1, $2::date)',
        [id, dayOf(thirdAsk - 1)]
      );
      const onTheDay = await client.query(
        'select count(*)::int as n from public.detect_contrast_candidates($1, $2::date)',
        [id, dayOf(thirdAsk)]
      );

      // Two answers is not a declaration. Three is.
      expect(before.rows[0].n).toBe(0);
      expect(onTheDay.rows[0].n).toBe(1);
    });

    test('confirmation is still silence — agreeing behaviour yields no card', async () => {
      // The half of MN3's law FA1 must not erode. Same walk, same three
      // answers, but the person actually does protect the weekend.
      const id = await createTester();
      const codes: string[] = [];
      for (let n = 1; n <= 105; n += 1) {
        await client.query('select * from public.get_daily_question($1::date)', [dayOf(n)]);
        const { rows } = await client.query(
          `select q.code from public.reflections r
             join public.questions q on q.id = r.question_id
            where r.user_id = $1 and r.local_date = $2::date`,
          [id, dayOf(n)]
        );
        const code = rows[0]?.code ?? null;
        codes.push(code);
        await client.query(
          `update public.reflections set question_answer = $3, mood = 4
            where user_id = $1 and local_date = $2::date`,
          [id, dayOf(n), code === SEEDED ? 'protect it' : 'a']
        );
        await client.query(
          `insert into public.completions (user_id, circle_id, local_date, kind)
           values ($1, current_setting('fa1.circle')::uuid, $2::date, 'self')`,
          [id, dayOf(n)]
        );
      }
      const days = askDays(codes, SEEDED);
      expect(days.length).toBeGreaterThanOrEqual(3);
      const { rows } = await client.query(
        'select count(*)::int as n from public.detect_contrast_candidates($1, $2::date)',
        [id, dayOf(days[2])]
      );
      expect(rows[0].n).toBe(0);
    });
  });

  describe("OD2 job S — the declared window follows the question's POOL", () => {
    /**
     * Cat ruled 8 Aug: widen MN3's declared window for weekend-pool
     * questions, and HAB-15 STAYS on `pool = 'weekend'`. The window is no
     * longer the constant 90 — it is derived, cycle period x
     * (last asks - 1), so 3 x 30 = 90 for `pool = 'any'` and 3 x 35 = 105
     * for `pool = 'weekend'`.
     *
     * These tests live in FA1's suite deliberately rather than in a
     * seventeenth integration file: the only other tests of
     * `detect_contrast_candidates` are the two above, this suite already
     * holds the question-bank mutex for its own bank write, and WC1
     * measured a connection burst from 16 workers dialling at once as the
     * likely cause of two whole-net red runs. A new suite is not free.
     *
     * They also do not walk `get_daily_question`. The rows are written
     * directly at chosen dates, so the fixture is exact and carries none
     * of M1's seeded-lottery risk — the point here is the WINDOW, and a
     * 105-day replay would only obscure it.
     */

    /** The case the old constant dropped, and the reason the multiplier is
     * (last asks - 1) rather than (min - 1): the three qualifying answers
     * are asks 1, 2 and 4, so the set spans THREE cycles, not two. */
    async function declareOverSpan(firstAskDaysBack: number): Promise<string> {
      const id = await createTester();
      const { rows: q } = await client.query(
        'select id from public.questions where code = $1',
        [SEEDED]
      );
      const asOf = dayOf(200);
      const back = (n: number) =>
        `(date '${asOf}' - ${n})`;
      // Four asks; the odd one out is the THIRD, so 'protect it' wins the
      // group-by 3-1 and `v_declared_first` is the earliest of the three.
      const asks: [number, string][] = [
        [firstAskDaysBack, 'protect it'],
        [Math.floor(firstAskDaysBack * 0.65), 'protect it'],
        [Math.floor(firstAskDaysBack * 0.33), 'let it slip'],
        [0, 'protect it'],
      ];
      for (const [n, answer] of asks) {
        await client.query(
          `insert into public.reflections
             (user_id, local_date, mood, question_id, question_answer, question_skipped)
           values ($1, ${back(n)}, 4, $2, $3, false)`,
          [id, q[0].id, answer]
        );
      }
      // Checks in on every WEEKDAY and never at a weekend, so the observed
      // side disagrees with "protect it" by a full 1.0 — far past the 0.25
      // threshold, which is not what these tests are about.
      await client.query(
        `insert into public.completions (user_id, circle_id, local_date, kind)
         select $1, current_setting('fa1.circle')::uuid, d::date, 'self'
           from generate_series(${back(firstAskDaysBack)}, date '${asOf}', interval '1 day') d
          where extract(dow from d)::int not in (0, 6)
            and not exists (
              select 1 from public.completions c
               where c.user_id = $1 and c.local_date = d::date
            )`,
        [id]
      );
      return id;
    }

    async function candidates(id: string, asOf: string): Promise<number> {
      const { rows } = await client.query(
        'select count(*)::int as n from public.detect_contrast_candidates($1, $2::date)',
        [id, asOf]
      );
      return rows[0].n;
    }

    test('a declaration spanning 100 days is DETECTED — the old 90 dropped it', async () => {
      const id = await declareOverSpan(100);
      expect(await candidates(id, dayOf(200))).toBe(1);
    });

    test('the edge is exactly 105 days inclusive, not 90 and not forever', async () => {
      // 104 days back is the 105th day of the window and still inside it;
      // 105 days back is the first day outside. Both asserted, because a
      // window that never excludes anything is not a window.
      expect(await candidates(await declareOverSpan(104), dayOf(200))).toBe(1);
      expect(await candidates(await declareOverSpan(105), dayOf(200))).toBe(0);
    });

    test("moving the question to pool 'any' pulls the window back to 90 — it is the POOL that decides", async () => {
      // The other direction, forced rather than reasoned: the SAME rows
      // that fire on 'weekend' go silent on 'any', and a 30-day-cycle
      // question is still held to 90 days exactly as the ruling required.
      // This writes to the shared bank, so it takes the mutex — see
      // supabase/question-bank-lock.ts and CLAUDE.md's Testing section.
      const spanning100 = await declareOverSpan(100);
      const spanning89 = await declareOverSpan(89);
      expect(await candidates(spanning100, dayOf(200))).toBe(1);

      await withQuestionBank(client, 'first-ask: HAB-15 pool flipped to any', async () => {
        await client.query(
          `update public.questions set pool = 'any' where code = '${SEEDED}'`
        );
        try {
          expect(await candidates(spanning100, dayOf(200))).toBe(0);
          expect(await candidates(spanning89, dayOf(200))).toBe(1);
        } finally {
          await client.query(
            `update public.questions set pool = 'weekend' where code = '${SEEDED}'`
          );
        }
      });

      // And the bank is back where it was, so nothing downstream inherits
      // a question that quietly changed pool.
      const { rows } = await client.query(
        `select pool from public.questions where code = '${SEEDED}'`
      );
      expect(rows[0].pool).toBe('weekend');
    });
  });
});
