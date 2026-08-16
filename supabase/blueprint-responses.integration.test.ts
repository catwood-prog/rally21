/**
 * BP1 — one blueprint response per (person, pattern), and the LAST answer
 * wins.
 *
 * WHAT THIS EXISTS FOR. `blueprint_responses` carried ZERO unique
 * constraints from 7 July to 16 Aug, and the client wrote with a plain
 * `.insert()`, so every tap of "sounds right" appended another row —
 * seven identical `confirmed` rows for one pattern in eleven seconds when
 * the card failed to tell the person it had landed. The render half is
 * fixed in screens-tests/private-map-answer-state.test.tsx; this pins the
 * half that survives any screen: the DATA cannot hold two answers for one
 * pattern even if something taps twice.
 *
 * THE WRITES BELOW ARE THE REAL ONE. `insert ... on conflict (user_id,
 * pattern_key) do update` is exactly what supabase-js emits for
 * `.upsert(..., { onConflict: 'user_id,pattern_key' })` in
 * lib/blueprint.ts's respondToBlueprintPattern, run as the `authenticated`
 * role under RLS — which is the only way to prove the new UPDATE policy is
 * there, since `on conflict do update` needs UPDATE as well as INSERT and
 * this table had SELECT + INSERT only until today.
 *
 * Same connection/rollback pattern as the other suites: needs
 * SUPABASE_DB_URL (see "Running the RPC-boundary integration tests" in
 * CLAUDE.md), runs in one transaction, always rolled back. Writes nothing
 * to public.questions, so it takes no question-bank mutex.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  // No `eslint-disable no-console` here, unlike the sibling suites: the
  // rule is off in this config, so their directives are dead and eslint
  // reports each one as an unused-directive WARNING. Copying it would have
  // moved EL1's documented 87 to 88 for nothing.
  console.warn(
    '[blueprint-responses.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

describeIfConfigured('blueprint responses (BP1: one row per pattern)', () => {
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
    // The on_auth_user_created trigger makes the matching public.users row.
    await client.query('insert into auth.users (id) values ($1)', [id]);
    return id;
  }

  /** Byte-for-byte the statement supabase-js emits for the client's
   * `.upsert(..., { onConflict: 'user_id,pattern_key' })`. */
  async function respondAs(
    userId: string,
    patternKey: string,
    response: 'confirmed' | 'not_quite',
    note: string | null = null
  ) {
    await actAs(userId);
    await client.query(
      `insert into public.blueprint_responses (user_id, pattern_key, response, note)
       values ($1, $2, $3, $4)
       on conflict (user_id, pattern_key)
       do update set response = excluded.response, note = excluded.note`,
      [userId, patternKey, response, note]
    );
  }

  async function rowsFor(userId: string) {
    await actAs(userId);
    const { rows } = await client.query(
      'select pattern_key, response, note, created_at from public.blueprint_responses where user_id = $1 order by pattern_key',
      [userId]
    );
    return rows as { pattern_key: string; response: string; note: string | null; created_at: Date }[];
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

  test('the constraint exists, and it is the thing doing the work', async () => {
    await elevated();
    const { rows } = await client.query(
      `select pg_get_constraintdef(oid) as def
         from pg_constraint
        where conrelid = 'public.blueprint_responses'::regclass and contype = 'u'`
    );
    expect(rows.map((r) => r.def)).toEqual(['UNIQUE (user_id, pattern_key)']);
  });

  test('a SECOND tap does not create a second row', async () => {
    const user = await createFakeUser();
    await respondAs(user, 'consistency', 'confirmed');
    await respondAs(user, 'consistency', 'confirmed');
    await respondAs(user, 'consistency', 'confirmed');

    const rows = await rowsFor(user);
    expect(rows.length).toBe(1);
    expect(rows[0].response).toBe('confirmed');
  });

  test('a CHANGED answer replaces rather than appends, and the last one wins', async () => {
    const user = await createFakeUser();
    await respondAs(user, 'consistency', 'confirmed');
    await respondAs(user, 'consistency', 'not_quite', 'it’s actually after work');

    const rows = await rowsFor(user);
    expect(rows.length).toBe(1);
    expect(rows[0].response).toBe('not_quite');
    expect(rows[0].note).toBe('it’s actually after work');
  });

  test('created_at stays at the FIRST answer — it means when you answered, not when you last touched it', async () => {
    // Backdated explicitly: `now()` is the TRANSACTION timestamp, so
    // inside one transaction an untouched created_at and one reset to
    // now() are byte-identical and the assertion would prove nothing.
    const user = await createFakeUser();
    await respondAs(user, 'consistency', 'confirmed');
    await elevated();
    await client.query(
      "update public.blueprint_responses set created_at = '2026-01-01T00:00:00Z' where user_id = $1",
      [user]
    );

    await respondAs(user, 'consistency', 'not_quite', 'on reflection, no');

    const rows = await rowsFor(user);
    expect(rows[0].response).toBe('not_quite');
    expect(rows[0].created_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  test('a note belongs to the answer it was written for, so a later answer replaces it', async () => {
    // Keeping a `not_quite` correction attached to a later `confirmed` row
    // would make the row claim something the person never said.
    const user = await createFakeUser();
    await respondAs(user, 'consistency', 'not_quite', 'it’s actually after work');
    await respondAs(user, 'consistency', 'confirmed', null);

    const rows = await rowsFor(user);
    expect(rows.length).toBe(1);
    expect(rows[0].response).toBe('confirmed');
    expect(rows[0].note).toBeNull();
  });

  test('the constraint is per PERSON — two people may answer the same pattern', async () => {
    const one = await createFakeUser();
    const two = await createFakeUser();
    await respondAs(one, 'consistency', 'confirmed');
    await respondAs(two, 'consistency', 'not_quite', 'not me');

    expect((await rowsFor(one)).length).toBe(1);
    expect((await rowsFor(two))[0].response).toBe('not_quite');
  });

  test('and per PATTERN — a second pattern is a second row, not a replacement', async () => {
    const user = await createFakeUser();
    await respondAs(user, 'consistency', 'confirmed');
    await respondAs(user, 'time_of_day_before_noon_higher', 'confirmed');

    const rows = await rowsFor(user);
    expect(rows.map((r) => r.pattern_key)).toEqual(['consistency', 'time_of_day_before_noon_higher']);
  });

  test('the new UPDATE policy is owner-scoped — nobody can rewrite someone else’s answer', async () => {
    const owner = await createFakeUser();
    const stranger = await createFakeUser();
    await respondAs(owner, 'consistency', 'confirmed');

    await actAs(stranger);
    const { rowCount } = await client.query(
      "update public.blueprint_responses set response = 'not_quite' where user_id = $1",
      [owner]
    );
    expect(rowCount).toBe(0);

    expect((await rowsFor(owner))[0].response).toBe('confirmed');
  });
});
