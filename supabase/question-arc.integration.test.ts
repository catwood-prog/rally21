/**
 * CS1 — the cold-start arc, pinned where it actually runs.
 *
 * WHY THESE ASSERTIONS LIVE AT THE DATABASE AND NOT IN A UNIT TEST.
 * The arc is a `case v_arc_day when 1 then 'ENR-01' ...` inside
 * get_daily_question, and that is deliberately the ONLY place it exists.
 * A TypeScript copy of the mapping would be a second source of truth for
 * the same question — the drift class this project has already paid for
 * twice (PA4's false wall sentences, CY1's two hand-mirrored ladders) and
 * the same reason PA3's pebble economy is pinned here rather than mirrored.
 * So the order, the acceptance metric and the retire behaviour are all
 * asserted against the real function.
 *
 * get_daily_question branches on auth.uid(), which reads the
 * `request.jwt.claim.sub` GUC — only a real signed JWT or a direct,
 * privileged Postgres connection can set it. See "Running the RPC-boundary
 * integration tests" in CLAUDE.md. Everything runs inside one transaction,
 * always rolled back in afterAll, so it never leaves a row behind whatever
 * it asserts — including the is_archived flips in the retire tests.
 */
import { Client } from 'pg';

import { withQuestionBank } from './question-bank-lock';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  console.warn(
    '[question-arc.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

/** Cat's ruling, 30 July (Option B of two tabled). Days 1-13 only: day 14 is
 * NOT a fixed code — it falls through to the follow-up branch, which is
 * asserted separately below because what it resolves to depends on what the
 * person actually wrote. */
const ARC = [
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
];

describeIfConfigured('CS1 — the cold-start arc', () => {
  let client: Client;

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

  async function createFakeUser(): Promise<string> {
    const id = crypto.randomUUID();
    await client.query('insert into auth.users (id) values ($1)', [id]);
    return id;
  }

  /** Serve one day and answer it, the way a tester who never skips does.
   * Returns the question code actually served. */
  async function liveOneDay(userId: string, n: number): Promise<string> {
    await client.query('select * from public.get_daily_question($1::date)', [dayOf(n)]);
    await client.query(
      `update public.reflections set question_answer = $3
        where user_id = $1 and local_date = $2::date`,
      [userId, dayOf(n), `answer for day ${n}`]
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
    const id = await createFakeUser();
    await actAs(id);
    const codes: string[] = [];
    for (let n = 1; n <= through; n += 1) codes.push(await liveOneDay(id, n));
    return { id, codes };
  }

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  test('days 1-13 are the ruled order, and day 14 hands over to the follow-up branch', async () => {
    const { codes } = await livePerfectTester(14);

    expect(codes.slice(0, 13)).toEqual(ARC);
    // Day 14's follow-up is sourced from STR-03, which day 10 asked and this
    // tester answered — so it resolves to FU-07 rather than the VAL-09 floor.
    expect(codes[13]).toBe('FU-07');
  });

  test('THE ACCEPTANCE METRIC: a perfect 14-day tester reaches the manual with 5 entries across 4 sections', async () => {
    const { id } = await livePerfectTester(14);

    // Mirrors lib/manual.ts getMyManual(): declaration lane, a non-null
    // manual_section, answered and not skipped, one entry per question.
    const { rows } = await client.query(
      `select count(distinct q.code)::int as entries,
              count(distinct q.manual_section)::int as sections,
              array_agg(distinct q.manual_section order by q.manual_section) as section_list
         from public.reflections r
         join public.questions q on q.id = r.question_id
        where r.user_id = $1
          and not r.question_skipped
          and r.question_answer is not null
          and q.answer_lane = 'declaration'
          and q.manual_section is not null`,
      [id]
    );

    expect(rows[0].entries).toBeGreaterThanOrEqual(5);
    expect(rows[0].sections).toBeGreaterThanOrEqual(2);
    // The stronger claim CS1 actually shipped, so a future arc edit that
    // quietly drops a section fails here rather than silently thinning
    // the manual the friends cohort is being asked to react to.
    expect(rows[0].entries).toBe(5);
    expect(rows[0].section_list).toEqual([
      'connection',
      'energy-recovery',
      'misread',
      'overwhelm-restore',
    ]);
  });

  test('the arc holds the L2 depth cap: never 3 prior L2s on a day that is itself L2', async () => {
    const { id } = await livePerfectTester(13);

    const { rows } = await client.query(
      `select r.local_date, q.depth,
              (select count(*) from public.reflections r2
                 join public.questions q2 on q2.id = r2.question_id
                where r2.user_id = r.user_id and q2.depth = 'L2'
                  and r2.local_date >= r.local_date - 6
                  and r2.local_date < r.local_date)::int as prior_l2
         from public.reflections r
         join public.questions q on q.id = r.question_id
        where r.user_id = $1
        order by r.local_date`,
      [id]
    );

    for (const row of rows) {
      if (row.depth === 'L2') expect(row.prior_l2).toBeLessThan(3);
    }
  });

  test('same user, same date, same question — the arc is deterministic across a re-pick', async () => {
    const id = await createFakeUser();
    await actAs(id);

    const first: string[] = [];
    for (let n = 1; n <= 6; n += 1) first.push(await liveOneDay(id, n));

    // Wipe and let the engine choose from scratch rather than short-circuit
    // on the existing reflections row.
    await client.query('delete from public.reflections where user_id = $1', [id]);

    const second: string[] = [];
    for (let n = 1; n <= 6; n += 1) second.push(await liveOneDay(id, n));

    expect(second).toEqual(first);
  });

  describe('JOB 3 — the retire mechanism reaches the arc, not just the general pool', () => {
    async function archive(code: string, value: boolean) {
      await client.query('update public.questions set is_archived = $2 where code = $1', [
        code,
        value,
      ]);
    }

    // RE2, 8 Aug — M3. All three of these write to `public.questions`, which is
    // a fixture shared with re-ask-cycle and first-ask, so each takes its turn
    // at it rather than racing them for a row lock and dying at
    // `lock_timeout = 5s`. SELF-12 is inside re-ask-cycle's tracked set and so
    // was always exposed; VAL-09 and FU-07 were exposed only to that suite's
    // WHERE-less sweep, which RE2 narrowed. They come through here anyway — the
    // rule is every write to the bank, not a per-row judgement that goes stale
    // the next time the tracked set moves. See supabase/question-bank-lock.ts.
    test('a struck arc question is skipped, and the day falls through instead of blanking', async () => {
      await withQuestionBank(client, 'question-arc: SELF-12 struck', async () => {
        await archive('SELF-12', true);
        try {
          const id = await createFakeUser();
          await actAs(id);
          let day9: string | null = null;
          for (let n = 1; n <= 9; n += 1) day9 = await liveOneDay(id, n);

          expect(day9).not.toBe('SELF-12');
          expect(day9).toBe('VAL-09');
        } finally {
          await archive('SELF-12', false);
        }
      });
    });

    test('with the VAL-09 floor struck too, the last resort still hands back an L1/L2 question', async () => {
      await withQuestionBank(client, 'question-arc: SELF-12 + VAL-09 struck', async () => {
        await archive('SELF-12', true);
        await archive('VAL-09', true);
        try {
          const id = await createFakeUser();
          await actAs(id);
          let day9: string | null = null;
          for (let n = 1; n <= 9; n += 1) day9 = await liveOneDay(id, n);

          expect(day9).not.toBeNull();
          expect(['SELF-12', 'VAL-09']).not.toContain(day9);

          const { rows } = await client.query(
            'select depth, is_archived from public.questions where code = $1',
            [day9]
          );
          expect(rows[0].is_archived).toBe(false);
          expect(['L1', 'L2']).toContain(rows[0].depth);
        } finally {
          await archive('SELF-12', false);
          await archive('VAL-09', false);
        }
      });
    });

    test("day 14's follow-up select skips a struck template", async () => {
      await withQuestionBank(client, 'question-arc: FU-07 struck', async () => {
        await archive('FU-07', true);
        try {
          const { codes } = await livePerfectTester(14);
          expect(codes[13]).not.toBe('FU-07');
          expect(codes[13]).toBe('VAL-09');
        } finally {
          await archive('FU-07', false);
        }
      });
    });
  });
});
