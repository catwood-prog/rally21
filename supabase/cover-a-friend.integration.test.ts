/**
 * Integration test for the cover-a-friend feature's RLS rules on
 * `public.completions`: a member can log a `kind='covered'` completion
 * for someone else in the same circle, but only under all four
 * conditions the product spec requires — you can't cover yourself, only
 * members of the circle can cover, you can only cover a fellow member,
 * and only one cover per member per day (which doubles as "you can't
 * cover someone who already checked in today", since a same-day self
 * completion trips the same NOT EXISTS clause).
 *
 * See "Running the RPC-boundary integration test" in CLAUDE.md for how
 * to supply SUPABASE_DB_URL — this suite uses the same direct-connection,
 * `set local role authenticated`, single-rolled-back-transaction pattern
 * as caps.integration.test.ts and practice-privacy.integration.test.ts.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[cover-a-friend.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration test" in CLAUDE.md.'
  );
}

const TODAY = '2026-07-06';

describeIfConfigured('cover a friend — RLS on completions', () => {
  let client: Client;
  let practiceId: string;

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

  /** Inserts a circle plus its creator's membership directly, then adds
   * `extraMemberIds` as regular members — mirrors caps.integration's
   * seedCircle but takes explicit member ids so tests can name their
   * coverer/covered fixtures. */
  async function seedCircle(creatorId: string, extraMemberIds: string[] = []): Promise<string> {
    await elevated();
    const inviteCode = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows } = await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public)
       values ('Cover Test Circle', $1, $2, '08:00:00', $3, false)
       returning id`,
      [practiceId, inviteCode, creatorId]
    );
    const circleId = rows[0].id;
    await client.query(
      "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'owner')",
      [circleId, creatorId]
    );
    for (const memberId of extraMemberIds) {
      await client.query(
        "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'member')",
        [circleId, memberId]
      );
    }
    return circleId;
  }

  async function selfCheckin(userId: string, circleId: string, localDate: string) {
    await actAs(userId);
    await client.query(
      "insert into public.completions (circle_id, user_id, local_date, kind) values ($1, $2, $3, 'self')",
      [circleId, userId, localDate]
    );
  }

  async function cover(
    covererId: string,
    coveredUserId: string,
    circleId: string,
    localDate: string
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    await actAs(covererId);
    try {
      await client.query(
        `insert into public.completions (circle_id, user_id, local_date, kind, covered_by)
         values ($1, $2, $3, 'covered', $4)`,
        [circleId, coveredUserId, localDate, covererId]
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
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

  test('a member can cover another member who has not checked in today', async () => {
    const coverer = await createFakeUser();
    const covered = await createFakeUser();
    const circleId = await seedCircle(coverer, [covered]);

    const result = await cover(coverer, covered, circleId, TODAY);
    expect(result.ok).toBe(true);

    await elevated();
    const { rows } = await client.query(
      "select kind, covered_by from public.completions where circle_id = $1 and user_id = $2 and local_date = $3",
      [circleId, covered, TODAY]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('covered');
    expect(rows[0].covered_by).toBe(coverer);
  });

  test('one cover per member per day — a second cover for the same person/day is rejected', async () => {
    const coverer = await createFakeUser();
    const secondCoverer = await createFakeUser();
    const covered = await createFakeUser();
    const circleId = await seedCircle(coverer, [secondCoverer, covered]);

    expect((await cover(coverer, covered, circleId, TODAY)).ok).toBe(true);
    const second = await cover(secondCoverer, covered, circleId, TODAY);
    expect(second.ok).toBe(false);
  });

  test('cannot cover someone who has already checked in today themselves', async () => {
    const coverer = await createFakeUser();
    const covered = await createFakeUser();
    const circleId = await seedCircle(coverer, [covered]);

    await selfCheckin(covered, circleId, TODAY);
    const result = await cover(coverer, covered, circleId, TODAY);
    expect(result.ok).toBe(false);
  });

  test('cannot cover yourself', async () => {
    const user = await createFakeUser();
    const circleId = await seedCircle(user);

    const result = await cover(user, user, circleId, TODAY);
    expect(result.ok).toBe(false);
  });

  test('only members of the circle can cover', async () => {
    const owner = await createFakeUser();
    const covered = await createFakeUser();
    const outsider = await createFakeUser();
    const circleId = await seedCircle(owner, [covered]);

    const result = await cover(outsider, covered, circleId, TODAY);
    expect(result.ok).toBe(false);
  });

  test('cannot cover someone who is not a member of the circle', async () => {
    const coverer = await createFakeUser();
    const nonMember = await createFakeUser();
    const circleId = await seedCircle(coverer);

    const result = await cover(coverer, nonMember, circleId, TODAY);
    expect(result.ok).toBe(false);
  });

  test('a wave posts no completion — the covered member stays uncovered and uncheckedin', async () => {
    const waver = await createFakeUser();
    const target = await createFakeUser();
    const circleId = await seedCircle(waver, [target]);

    await actAs(waver);
    await client.query(
      "insert into public.wall_messages (circle_id, user_id, body) values ($1, $2, 'waved hello 👋')",
      [circleId, waver]
    );

    await elevated();
    const { rows } = await client.query(
      'select * from public.completions where circle_id = $1 and user_id = $2 and local_date = $3',
      [circleId, target, TODAY]
    );
    expect(rows).toHaveLength(0);
  });

  test('circle glow sees the covered day, but the covered member\'s personal (kind=self) history does not', async () => {
    const coverer = await createFakeUser();
    const covered = await createFakeUser();
    const circleId = await seedCircle(coverer, [covered]);

    expect((await cover(coverer, covered, circleId, TODAY)).ok).toBe(true);

    // Mirrors getCirclePresence's unfiltered select — feeds computeSignal,
    // so the circle's glow counts the covered day.
    await actAs(covered);
    const { rows: circlePresence } = await client.query(
      'select user_id, kind from public.completions where circle_id = $1 and local_date = $2',
      [circleId, TODAY]
    );
    expect(circlePresence.some((r) => r.user_id === covered && r.kind === 'covered')).toBe(true);

    // Mirrors getMyCompletions's kind='self' filter — feeds the covered
    // member's own weekly show-up count, which must stay honest.
    const { rows: personalHistory } = await client.query(
      "select * from public.completions where circle_id = $1 and user_id = $2 and kind = 'self'",
      [circleId, covered]
    );
    expect(personalHistory).toHaveLength(0);
  });
});
