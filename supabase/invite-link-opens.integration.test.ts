/**
 * IL1 job 3 — the pre-auth invite-open counter, proven at the real
 * boundary rather than on paper.
 *
 * This is the project's FIRST anon-executable function, so the properties
 * that make it defensible are the ones asserted here, one test each:
 * anon really can call it (the grant is not aspirational), it is not a
 * circle-existence oracle, a code that matches no circle writes nothing
 * (which is what bounds the table), the per-day cap really does make
 * further calls a no-op rather than a lock-churning update, and anon
 * cannot read a single row of what it just wrote.
 *
 * Same direct-connection, rollback-only pattern as the other RPC-boundary
 * suites — see "Running the RPC-boundary integration tests" in CLAUDE.md
 * for how to supply SUPABASE_DB_URL.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

// Kept in step with the migration's c_daily_open_cap / the CHECK.
const DAILY_OPEN_CAP = 200;

if (!DB_URL) {
  // (No eslint-disable for no-console here: the rule does not fire in this
  // directory, and the sibling suites' directives are all reported as
  // unused warnings. One fewer than the file next door, deliberately.)
  console.warn(
    '[invite-link-opens.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

describeIfConfigured('record_invite_link_open (IL1 job 3 anon boundary)', () => {
  let client: Client;
  let practiceId: string;
  // RE1's lesson, 6 Aug: a fixture that draws a fresh random value per run
  // is a hidden seed. Codes here are counter-based and deterministic. They
  // also cannot collide with a real circle's code by construction —
  // create_circle's alphabet excludes I, L, O, 0 and 1, and every code
  // below contains at least two of them.
  let codeCounter = 0;
  function nextCode(): string {
    codeCounter += 1;
    return `IL${String(codeCounter).padStart(4, '0')}`;
  }

  async function elevated() {
    await client.query('reset role');
  }

  async function actAsAnon() {
    await client.query('set local role anon');
    await client.query("select set_config('request.jwt.claim.sub', '', true)");
  }

  async function expectRejection(sql: string, params: unknown[], match: RegExp) {
    await client.query('savepoint expected_failure');
    await expect(client.query(sql, params)).rejects.toThrow(match);
    await client.query('rollback to savepoint expected_failure');
  }

  async function seedCircleWithCode(code: string): Promise<void> {
    await elevated();
    const id = crypto.randomUUID();
    await client.query('insert into auth.users (id) values ($1)', [id]);
    await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by)
       values ('IL1 fixture circle', $1, $2, '08:00:00', $3)`,
      [practiceId, code, id]
    );
  }

  async function opensFor(code: string): Promise<number | null> {
    await elevated();
    const { rows } = await client.query<{ opens: number }>(
      'select opens from analytics.invite_link_opens where invite_code = $1 and open_date = current_date',
      [code]
    );
    return rows.length === 0 ? null : Number(rows[0].opens);
  }

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    await client.query('BEGIN');

    const { rows } = await client.query(
      'select id from public.practices where is_archived = false limit 1'
    );
    if (rows.length === 0) throw new Error('fixture requires at least one non-archived practice');
    practiceId = rows[0].id;
  });

  afterAll(async () => {
    await elevated();
    await client.query('ROLLBACK');
    await client.end();
  });

  test('a signed-out caller can execute it — the deliberate grant is real', async () => {
    const code = nextCode();
    await seedCircleWithCode(code);

    await actAsAnon();
    // Not `resolves.toBeDefined()` on its own: the point is that anon is
    // not refused at 42501, which is what every other public function does.
    await expect(client.query('select public.record_invite_link_open($1)', [code])).resolves.toBeDefined();

    expect(await opensFor(code)).toBe(1);
  });

  test('opens accumulate for a real code', async () => {
    const code = nextCode();
    await seedCircleWithCode(code);

    await actAsAnon();
    await client.query('select public.record_invite_link_open($1)', [code]);
    await client.query('select public.record_invite_link_open($1)', [code]);
    await client.query('select public.record_invite_link_open($1)', [code]);

    expect(await opensFor(code)).toBe(3);
  });

  test('the code is matched case-insensitively, as join_circle_by_code matches it', async () => {
    const code = nextCode();
    await seedCircleWithCode(code);

    await actAsAnon();
    await client.query('select public.record_invite_link_open($1)', [code.toLowerCase()]);
    await client.query('select public.record_invite_link_open($1)', [` ${code} `]);

    expect(await opensFor(code)).toBe(2);
  });

  test('a well-shaped code matching no circle writes NOTHING — this is what bounds the table', async () => {
    const unknown = nextCode();
    // deliberately NOT seeded

    await actAsAnon();
    await client.query('select public.record_invite_link_open($1)', [unknown]);

    // A stranger sweeping the six-character space cannot grow this table
    // by one row, which is the difference between a counter and a dump.
    expect(await opensFor(unknown)).toBeNull();
  });

  test('it is not an existence oracle: real and unknown codes return the identical nothing', async () => {
    const real = nextCode();
    await seedCircleWithCode(real);
    const unknown = nextCode();

    await actAsAnon();
    const hit = await client.query('select public.record_invite_link_open($1) as r', [real]);
    const miss = await client.query('select public.record_invite_link_open($1) as r', [unknown]);

    // void renders as '' — same shape, same value, no row count, no error.
    expect(hit.rows).toEqual(miss.rows);
    expect(hit.rows[0].r).toBe('');
  });

  test('malformed input is ignored silently, never an error a stranger would see', async () => {
    await actAsAnon();
    for (const bad of ['', '   ', 'ABC', 'ABCDEFG', 'ABC-12', "'; drop table circles; --", null]) {
      await expect(
        client.query('select public.record_invite_link_open($1)', [bad])
      ).resolves.toBeDefined();
    }
  });

  test('the per-day cap makes further opens a genuine no-op, not a runaway update', async () => {
    const code = nextCode();
    await seedCircleWithCode(code);

    await elevated();
    await client.query(
      `insert into analytics.invite_link_opens (invite_code, open_date, opens)
       values ($1, current_date, $2)`,
      [code, DAILY_OPEN_CAP]
    );

    await actAsAnon();
    await client.query('select public.record_invite_link_open($1)', [code]);
    await client.query('select public.record_invite_link_open($1)', [code]);

    // Not merely "clamped to the cap" — the WHERE means no row version is
    // written at all, so hammering it costs nothing to lock. If a future
    // edit drops the WHERE, the CHECK constraint turns this into a loud
    // failure rather than a silent one.
    expect(await opensFor(code)).toBe(DAILY_OPEN_CAP);
  });

  test('anon cannot read a single row of what it just wrote', async () => {
    const code = nextCode();
    await seedCircleWithCode(code);

    await actAsAnon();
    await client.query('select public.record_invite_link_open($1)', [code]);

    // `analytics` is granted to no role and is not PostgREST-exposed
    // (AN1). The write happens only because the function is SECURITY
    // DEFINER; the caller's own privileges are unchanged by it.
    await expectRejection(
      'select * from analytics.invite_link_opens',
      [],
      /permission denied for schema analytics/i
    );
  });

  test('the table cannot hold user text — AN1 no-text law, held by CHECK', async () => {
    await elevated();
    // A future migration adding a free-text column would still have to get
    // past this: the only text column there is refuses anything that is not
    // exactly the generator's shape.
    await expectRejection(
      `insert into analytics.invite_link_opens (invite_code, open_date, opens)
       values ($1, current_date, 1)`,
      ['a note someone typed'],
      /invite_link_opens_code_shape/i
    );
  });
});
