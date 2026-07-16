/**
 * Integration test for edit_circle (EC1): hosts edit their circle — name,
 * time of day, resource link, and the practice wording/duration — with
 * host-only enforcement at the database, the update-in-place vs
 * clone-and-repoint practice rule, and the day counter (start_date /
 * duration_days) provably untouched.
 *
 * Same harness as caps.integration.test.ts: a direct privileged Postgres
 * connection (SUPABASE_DB_URL — see "Running the RPC-boundary integration
 * tests" in CLAUDE.md), everything inside one transaction rolled back in
 * afterAll. Statements expected to fail are wrapped in a savepoint so the
 * outer transaction survives the abort.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[edit-circle.integration.test] SUPABASE_DB_URL not set — skipping the RPC-boundary integration test. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

describeIfConfigured('edit_circle at the RPC boundary', () => {
  let client: Client;

  async function actAs(userId: string) {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  }

  async function createFakeUser(): Promise<string> {
    const id = crypto.randomUUID();
    await client.query('insert into auth.users (id) values ($1)', [id]);
    return id;
  }

  async function createPractice(opts: {
    name: string;
    createdBy?: string | null;
    durationMinutes?: number | null;
    isShared?: boolean;
  }): Promise<string> {
    const { rows } = await client.query(
      `insert into public.practices (name, category, duration_minutes, created_by, is_shared)
       values ($1, 'mind', $2, $3, $4) returning id`,
      [opts.name, opts.durationMinutes ?? null, opts.createdBy ?? null, opts.isShared ?? true]
    );
    return rows[0].id;
  }

  async function seedCircle(
    creatorId: string,
    practiceId: string,
    opts: { isPublic?: boolean } = {}
  ): Promise<string> {
    const inviteCode = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows } = await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public, start_date)
       values ('Fixture Circle', $1, $2, '08:00:00', $3, $4, current_date - 5)
       returning id`,
      [practiceId, inviteCode, creatorId, opts.isPublic ?? false]
    );
    const circleId = rows[0].id;
    await client.query(
      "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'owner')",
      [circleId, creatorId]
    );
    return circleId;
  }

  function editCircleSql(
    circleId: string,
    fields: {
      name?: string;
      timeOfDay?: string | null;
      resourceUrl?: string | null;
      practiceName?: string;
      practiceDurationMinutes?: number | null;
    }
  ) {
    return client.query('select edit_circle($1, $2, $3, $4, $5, $6)', [
      circleId,
      fields.name ?? 'Fixture Circle',
      fields.timeOfDay ?? '08:00:00',
      fields.resourceUrl ?? null,
      fields.practiceName ?? 'Fixture practice',
      fields.practiceDurationMinutes ?? null,
    ]);
  }

  /** Runs a statement expected to abort inside a savepoint, so the outer
   * always-rolled-back transaction stays usable for the next test. */
  async function expectRejectsWith(promiseFactory: () => Promise<unknown>, messagePart: string) {
    await client.query('savepoint expected_failure');
    try {
      await expect(promiseFactory()).rejects.toMatchObject({
        message: expect.stringContaining(messagePart),
      });
    } finally {
      await client.query('rollback to savepoint expected_failure');
    }
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

  test('host edits circle fields; day counter (start_date/duration_days) never moves', async () => {
    const host = await createFakeUser();
    const practiceId = await createPractice({ name: 'Fixture practice' });
    const circleId = await seedCircle(host, practiceId);

    const before = await client.query(
      'select start_date, duration_days from public.circles where id = $1',
      [circleId]
    );

    await actAs(host);
    await editCircleSql(circleId, {
      name: 'Renamed Circle',
      timeOfDay: '18:00:00',
      resourceUrl: 'https://example.com/playlist',
      practiceName: 'Fixture practice',
    });

    const after = await client.query(
      'select name, time_of_day, resource_url, start_date, duration_days from public.circles where id = $1',
      [circleId]
    );
    expect(after.rows[0].name).toBe('Renamed Circle');
    expect(after.rows[0].time_of_day).toBe('18:00:00');
    expect(after.rows[0].resource_url).toBe('https://example.com/playlist');
    expect(after.rows[0].start_date).toEqual(before.rows[0].start_date);
    expect(after.rows[0].duration_days).toBe(before.rows[0].duration_days);
  });

  test('a non-host (member or stranger) is rejected at the database', async () => {
    const host = await createFakeUser();
    const practiceId = await createPractice({ name: 'Fixture practice' });
    const circleId = await seedCircle(host, practiceId);
    const member = await createFakeUser();
    await client.query(
      "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'member')",
      [circleId, member]
    );

    await actAs(member);
    await expectRejectsWith(
      () => editCircleSql(circleId, { name: 'Hijacked' }),
      "Only the circle's host can edit it"
    );

    const stranger = await createFakeUser();
    await actAs(stranger);
    await expectRejectsWith(
      () => editCircleSql(circleId, { name: 'Hijacked' }),
      "Only the circle's host can edit it"
    );

    // And a forged direct UPDATE (not via the RPC) dies at RLS: with the
    // authenticated role and a non-host JWT, the creator-only UPDATE
    // policy matches zero rows.
    await client.query('savepoint forged_update');
    await client.query('set local role authenticated');
    const forged = await client.query("update public.circles set name = 'Forged' where id = $1", [
      circleId,
    ]);
    expect(forged.rowCount).toBe(0);
    await client.query('rollback to savepoint forged_update');

    const { rows } = await client.query('select name from public.circles where id = $1', [circleId]);
    expect(rows[0].name).toBe('Fixture Circle');
  });

  test('editing a seeded/shared practice clones a host-owned copy and repoints only this circle', async () => {
    const host = await createFakeUser();
    const seededPracticeId = await createPractice({ name: 'Meditate 10 minutes', durationMinutes: 10 });
    const otherCircle = await seedCircle(await createFakeUser(), seededPracticeId);
    const circleId = await seedCircle(host, seededPracticeId);

    await actAs(host);
    await editCircleSql(circleId, { practiceName: 'Meditate 25 minutes', practiceDurationMinutes: 25 });

    const seeded = await client.query('select name, duration_minutes from public.practices where id = $1', [
      seededPracticeId,
    ]);
    expect(seeded.rows[0].name).toBe('Meditate 10 minutes');
    expect(seeded.rows[0].duration_minutes).toBe(10);

    const { rows: circleRows } = await client.query(
      `select p.id, p.name, p.duration_minutes, p.created_by, p.is_shared
       from public.circles c join public.practices p on p.id = c.practice_id
       where c.id = $1`,
      [circleId]
    );
    expect(circleRows[0].id).not.toBe(seededPracticeId);
    expect(circleRows[0].name).toBe('Meditate 25 minutes');
    expect(circleRows[0].duration_minutes).toBe(25);
    expect(circleRows[0].created_by).toBe(host);
    // private circle -> the clone stays private (practice-privacy rule)
    expect(circleRows[0].is_shared).toBe(false);

    const other = await client.query('select practice_id from public.circles where id = $1', [
      otherCircle,
    ]);
    expect(other.rows[0].practice_id).toBe(seededPracticeId);
  });

  test("editing the host's own single-circle custom practice updates it in place", async () => {
    const host = await createFakeUser();
    const customPracticeId = await createPractice({
      name: 'Read before bed',
      createdBy: host,
      isShared: false,
    });
    const circleId = await seedCircle(host, customPracticeId);

    await actAs(host);
    await editCircleSql(circleId, { practiceName: 'Read 10 pages before bed', practiceDurationMinutes: 15 });

    const { rows } = await client.query(
      `select c.practice_id, p.name, p.duration_minutes
       from public.circles c join public.practices p on p.id = c.practice_id
       where c.id = $1`,
      [circleId]
    );
    expect(rows[0].practice_id).toBe(customPracticeId);
    expect(rows[0].name).toBe('Read 10 pages before bed');
    expect(rows[0].duration_minutes).toBe(15);
  });

  test("a public circle's practice clone is shared, not private", async () => {
    const host = await createFakeUser();
    const seededPracticeId = await createPractice({ name: 'Walk 20 minutes' });
    await seedCircle(await createFakeUser(), seededPracticeId);
    const circleId = await seedCircle(host, seededPracticeId, { isPublic: true });

    await actAs(host);
    await editCircleSql(circleId, { practiceName: 'Walk 30 minutes', practiceDurationMinutes: 30 });

    const { rows } = await client.query(
      `select p.is_shared from public.circles c join public.practices p on p.id = c.practice_id where c.id = $1`,
      [circleId]
    );
    expect(rows[0].is_shared).toBe(true);
  });

  test('an unchanged practice is left alone — no clone, no repoint', async () => {
    const host = await createFakeUser();
    const seededPracticeId = await createPractice({ name: 'Stretch 5 minutes', durationMinutes: 5 });
    const circleId = await seedCircle(host, seededPracticeId);

    await actAs(host);
    await editCircleSql(circleId, {
      name: 'Renamed Only',
      practiceName: 'Stretch 5 minutes',
      practiceDurationMinutes: 5,
    });

    const { rows } = await client.query('select practice_id from public.circles where id = $1', [
      circleId,
    ]);
    expect(rows[0].practice_id).toBe(seededPracticeId);
  });
});
