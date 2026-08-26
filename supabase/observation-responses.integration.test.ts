/**
 * OB1 — one observation response per (person, pattern_type, direction),
 * and the LAST answer wins.
 *
 * WHAT THIS EXISTS FOR. `observation_responses` carried ZERO unique
 * constraints from 4 July to 26 Aug, and lib/reflections.ts wrote with a
 * plain `.insert()` — byte-for-byte the shape BP1 found in
 * `blueprint_responses`, where seven identical `confirmed` rows for one
 * pattern landed in eleven seconds once the card stopped telling the
 * person their tap had worked. The only thing that has ever stopped it
 * here is reflection.tsx's `response === null ?` render guard, and that
 * guard is the exact one the private map lacked. It stays. This suite
 * pins the half that survives any screen: the DATA cannot hold two
 * answers to one claim even if something taps twice.
 *
 * THE KEY IS THE TRIPLE, AND THE READER IS WHY. `getMyObservationResponse`
 * filters on user_id, pattern_type AND direction, so a flipped direction
 * is a different sentence about the person and a different thing to have
 * answered. The "a flipped direction is a SECOND row" test below is the
 * one that would fail if this were ever narrowed to (user_id,
 * pattern_type).
 *
 * THE WRITES BELOW ARE THE REAL ONE. `insert ... on conflict (user_id,
 * pattern_type, direction) do update` is exactly what supabase-js emits
 * for `.upsert(..., { onConflict: 'user_id,pattern_type,direction' })` in
 * saveObservationResponse, run as the `authenticated` role under RLS —
 * which is the only way to prove the new UPDATE policy is there, since
 * `on conflict do update` needs UPDATE as well as INSERT and this table
 * had SELECT + INSERT only until today.
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
  console.warn(
    '[observation-responses.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

describeIfConfigured('observation responses (OB1: one row per claim)', () => {
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
   * `.upsert(..., { onConflict: 'user_id,pattern_type,direction' })`.
   * `created_at` is absent from the payload, so it is absent from the
   * `do update set` — which is the whole point of the created_at test. */
  async function respondAs(
    userId: string,
    patternType: 'time_of_day' | 'weekday',
    direction: string,
    response: 'confirmed' | 'rejected',
    agreementCount = 9,
    totalCount = 12
  ) {
    await actAs(userId);
    await client.query(
      `insert into public.observation_responses
         (user_id, pattern_type, direction, agreement_count, total_count, response)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id, pattern_type, direction)
       do update set agreement_count = excluded.agreement_count,
                     total_count = excluded.total_count,
                     response = excluded.response`,
      [userId, patternType, direction, agreementCount, totalCount, response]
    );
  }

  async function rowsFor(userId: string) {
    await actAs(userId);
    const { rows } = await client.query(
      `select pattern_type, direction, response, agreement_count, total_count, created_at
         from public.observation_responses
        where user_id = $1
        order by pattern_type, direction`,
      [userId]
    );
    return rows as {
      pattern_type: string;
      direction: string;
      response: string;
      agreement_count: number;
      total_count: number;
      created_at: Date;
    }[];
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
        where conrelid = 'public.observation_responses'::regclass and contype = 'u'`
    );
    expect(rows.map((r) => r.def)).toEqual(['UNIQUE (user_id, pattern_type, direction)']);
  });

  test('a SECOND tap does not create a second row', async () => {
    const user = await createFakeUser();
    await respondAs(user, 'time_of_day', 'before_noon_higher', 'confirmed');
    await respondAs(user, 'time_of_day', 'before_noon_higher', 'confirmed');
    await respondAs(user, 'time_of_day', 'before_noon_higher', 'confirmed');

    const rows = await rowsFor(user);
    expect(rows.length).toBe(1);
    expect(rows[0].response).toBe('confirmed');
  });

  test('a CHANGED answer replaces rather than appends, and the last one wins', async () => {
    const user = await createFakeUser();
    await respondAs(user, 'time_of_day', 'before_noon_higher', 'confirmed');
    await respondAs(user, 'time_of_day', 'before_noon_higher', 'rejected');

    const rows = await rowsFor(user);
    expect(rows.length).toBe(1);
    expect(rows[0].response).toBe('rejected');
  });

  test('the counts move with the answer — they are the evidence it was given against', async () => {
    // agreement_count/total_count are what the person was SHOWN when they
    // answered ("9 of your last 12 days"). Leaving them at the older
    // reading would make the row cite numbers nobody put in front of them.
    const user = await createFakeUser();
    await respondAs(user, 'weekday', 'weekend_higher', 'confirmed', 8, 12);
    await respondAs(user, 'weekday', 'weekend_higher', 'rejected', 11, 14);

    const rows = await rowsFor(user);
    expect(rows.length).toBe(1);
    expect(rows[0].agreement_count).toBe(11);
    expect(rows[0].total_count).toBe(14);
  });

  test('created_at stays at the FIRST answer — it means when you answered, not when you last touched it', async () => {
    // Backdated explicitly: `now()` is the TRANSACTION timestamp, so
    // inside one transaction an untouched created_at and one reset to
    // now() are byte-identical and the assertion would prove nothing.
    const user = await createFakeUser();
    await respondAs(user, 'weekday', 'weekday_higher', 'confirmed');
    await elevated();
    await client.query(
      "update public.observation_responses set created_at = '2026-01-01T00:00:00Z' where user_id = $1",
      [user]
    );

    await respondAs(user, 'weekday', 'weekday_higher', 'rejected');

    const rows = await rowsFor(user);
    expect(rows[0].response).toBe('rejected');
    expect(rows[0].created_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  test('a FLIPPED DIRECTION is a second row, not a replacement — the reader asks about the claim, not the pattern', async () => {
    // The load-bearing test for job 0's ruling. getMyObservationResponse
    // filters on direction as well as pattern_type, so "before noon is
    // your better half" and "after noon is" are two different sentences
    // to have answered. A unique (user_id, pattern_type) would forbid
    // this legitimate state and overwrite an answer the reader still
    // goes looking for.
    const user = await createFakeUser();
    await respondAs(user, 'time_of_day', 'before_noon_higher', 'confirmed');
    await respondAs(user, 'time_of_day', 'after_noon_higher', 'rejected');

    const rows = await rowsFor(user);
    expect(rows.map((r) => r.direction)).toEqual(['after_noon_higher', 'before_noon_higher']);
    expect(rows.length).toBe(2);
  });

  test('and per PATTERN TYPE — the weekday claim is not the time-of-day one', async () => {
    const user = await createFakeUser();
    await respondAs(user, 'time_of_day', 'before_noon_higher', 'confirmed');
    await respondAs(user, 'weekday', 'weekday_higher', 'confirmed');

    const rows = await rowsFor(user);
    expect(rows.map((r) => r.pattern_type)).toEqual(['time_of_day', 'weekday']);
  });

  test('the constraint is per PERSON — two people may answer the same claim', async () => {
    const one = await createFakeUser();
    const two = await createFakeUser();
    await respondAs(one, 'weekday', 'weekend_higher', 'confirmed');
    await respondAs(two, 'weekday', 'weekend_higher', 'rejected');

    expect((await rowsFor(one)).length).toBe(1);
    expect((await rowsFor(two))[0].response).toBe('rejected');
  });

  test('the new UPDATE policy is owner-scoped — nobody can rewrite someone else’s answer', async () => {
    const owner = await createFakeUser();
    const stranger = await createFakeUser();
    await respondAs(owner, 'weekday', 'weekend_higher', 'confirmed');

    await actAs(stranger);
    const { rowCount } = await client.query(
      "update public.observation_responses set response = 'rejected' where user_id = $1",
      [owner]
    );
    expect(rowCount).toBe(0);

    expect((await rowsFor(owner))[0].response).toBe('confirmed');
  });
});
