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
 * meaning to fails here. */
const TRACKED = ['CON-10', 'ENR-09', 'MOOD-09', 'SELF-12', 'STR-03'];

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

  /** A user in a circle that started on day 1 — the replay needs the
   * membership because `v_missed_yesterday` reads completions, and a user
   * with no completions at all looks like someone who misses every day. */
  async function createTester(): Promise<string> {
    const id = crypto.randomUUID();
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
      const withCycle = await trackedAskDays((await livePerfectTester(90)).id);
      for (const code of TRACKED) {
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
      const { id } = await livePerfectTester(90);
      const { rows } = await client.query(
        `select q.code, count(*)::int as n
           from public.reflections r
           join public.questions q on q.id = r.question_id
          where r.user_id = $1 and not q.reask_tracked
          group by q.code having count(*) >= 3`,
        [id]
      );
      expect(rows).toEqual([]);
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
    test('every tracked family reaches 3 answers, and the last one lands by day 73', async () => {
      const { id } = await livePerfectTester(75);
      const days = await trackedAskDays(id);

      for (const code of TRACKED) {
        const asks = days.get(code) ?? [];
        expect(asks.length).toBeGreaterThanOrEqual(3);
      }

      const thirds = TRACKED.map((code) => (days.get(code) ?? [])[2]);
      // Measured on the live function, 31 July: MOOD-09 day 64, ENR-09 66,
      // SELF-12 69, STR-03 71, CON-10 73. The assertion is the ceiling
      // rather than the exact five, so ordinary cap jitter doesn't fail the
      // suite — but a change that pushes the unlock into month four does.
      expect(Math.max(...thirds)).toBeLessThanOrEqual(73);
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
      // Five families, at most three asks each per 90 days — job 2's budget.
      expect(totalReasks).toBeLessThanOrEqual(15);
    });
  });
});
