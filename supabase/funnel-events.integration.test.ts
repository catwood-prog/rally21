/**
 * AN1 job 2 — the funnel_events boundary, proven at the real RLS layer.
 *
 * Three properties, and the third is the one that matters most:
 *   1. insert-own works, insert-for-someone-else does not;
 *   2. SELECT is founder-only — a stranger sees nothing, and so does the
 *      row's OWN author (deliberate: a person's funnel is of no use to
 *      them, and the policy that would let them read it is the same
 *      policy shape that leaks everyone else's);
 *   3. the table cannot hold user text AT THE SCHEMA LEVEL, because the
 *      event key is a Postgres enum rather than a text column with a
 *      check. That is the house law made structural instead of
 *      remembered, and it is asserted here so a future migration that
 *      quietly adds a `note text` column fails a test rather than a
 *      review.
 *
 * Same connection/rollback pattern as the other suites here: needs
 * SUPABASE_DB_URL (see "Running the RPC-boundary integration tests" in
 * CLAUDE.md), runs inside one transaction, always rolled back. The
 * `set local role authenticated` switch is load-bearing — a direct
 * connection's default role owns these tables and bypasses RLS entirely,
 * so without it this suite would prove nothing at all.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

// The founder allowlist is hardcoded inside is_founder() (MOD1's
// deliberate duplication of the app_caps() pattern). This is Cat's own
// account id, quoted from that migration.
const FOUNDER_ID = '75ec0d88-27de-4227-ab62-3d049b369960';

if (!DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[funnel-events.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

describeIfConfigured('funnel_events (AN1 job 2 RLS boundary)', () => {
  let client: Client;

  async function elevated() {
    await client.query('reset role');
  }

  async function actAs(userId: string) {
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  }

  async function createFakeUser(): Promise<string> {
    await elevated();
    const id = crypto.randomUUID();
    await client.query('insert into auth.users (id) values ($1)', [id]);
    return id;
  }

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await elevated();
    await client.query('ROLLBACK');
    await client.end();
  });

  test('insert-own is allowed; inserting against another user is refused', async () => {
    const me = await createFakeUser();
    const someoneElse = await createFakeUser();

    await actAs(me);
    await expect(
      client.query('insert into public.funnel_events (user_id, event) values ($1, $2)', [
        me,
        'onboarding_profile_opened',
      ])
    ).resolves.toBeDefined();

    // The whole point of the with-check: a client may record that IT did
    // something, never that somebody else did.
    await expect(
      client.query('insert into public.funnel_events (user_id, event) values ($1, $2)', [
        someoneElse,
        'onboarding_profile_opened',
      ])
    ).rejects.toThrow(/row-level security/i);
  });

  test('SELECT is founder-only: stranger sees nothing, the author sees nothing, the founder sees the row', async () => {
    const author = await createFakeUser();
    const stranger = await createFakeUser();

    await actAs(author);
    await client.query('insert into public.funnel_events (user_id, event) values ($1, $2)', [
      author,
      'invite_share_opened',
    ]);

    // The author's own read is blocked too — insert-own does not imply
    // read-own, and that is deliberate, not an oversight.
    const own = await client.query('select id from public.funnel_events where user_id = $1', [author]);
    expect(own.rows.length).toBe(0);

    await actAs(stranger);
    const theirs = await client.query('select id from public.funnel_events where user_id = $1', [author]);
    expect(theirs.rows.length).toBe(0);

    await actAs(FOUNDER_ID);
    const founderView = await client.query('select event from public.funnel_events where user_id = $1', [author]);
    expect(founderView.rows.map((r) => r.event)).toEqual(['invite_share_opened']);
  });

  test('no text can ever be written here — the key is an enum and no text column exists', async () => {
    await elevated();

    const { rows: columns } = await client.query(
      `select column_name, data_type
         from information_schema.columns
        where table_schema = 'public' and table_name = 'funnel_events'`
    );
    // uuid, uuid, USER-DEFINED (the enum), timestamptz — and nothing else.
    expect(columns.length).toBeGreaterThan(0);
    expect(
      columns.filter((c) => ['text', 'character varying', 'character'].includes(c.data_type))
    ).toEqual([]);
    expect(columns.find((c) => c.column_name === 'event')?.data_type).toBe('USER-DEFINED');

    // And the enum really does refuse anything outside the fixed set, so
    // a typo'd key fails loudly at write time rather than landing as a
    // silent extra category nobody notices in the lens.
    const me = await createFakeUser();
    await actAs(me);
    await expect(
      client.query('insert into public.funnel_events (user_id, event) values ($1, $2)', [
        me,
        'something_a_caller_made_up',
      ])
    ).rejects.toThrow(/invalid input value for enum/i);
  });
});
