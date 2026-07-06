/**
 * Integration test for the shared app_caps() enforcement (code-audit-jul.md
 * §5.3): the 3-circles-per-user and 12-members-per-circle caps, and that
 * create_circle / join_circle_by_code / join_public_circle reject at the
 * same boundary with the same message.
 *
 * These RPCs are SECURITY DEFINER and branch on auth.uid(), which reads
 * the `request.jwt.claim.sub` Postgres GUC — something only a real signed
 * JWT (via Supabase Auth) or a direct, privileged Postgres connection can
 * set. There is no way to impersonate a specific user through the
 * anon-key REST client used by the app itself, so this suite needs a
 * direct database connection instead — see "Running the RPC-boundary
 * integration test" in CLAUDE.md for how to supply one.
 *
 * Everything below runs inside a single transaction that is always rolled
 * back in afterAll, so it never leaves any row behind no matter what a
 * test asserts.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[caps.integration.test] SUPABASE_DB_URL not set — skipping the RPC-boundary integration test. ' +
      'See "Running the RPC-boundary integration test" in CLAUDE.md.'
  );
}

const THREE_CIRCLES_MESSAGE = "You're in 3 circles already — finish one or leave one to add another.";
const CIRCLE_FULL_MESSAGE = 'This circle is already full';

describeIfConfigured('caps at the RPC boundary', () => {
  let client: Client;
  let practiceId: string;
  let practiceKey: string;

  async function actAs(userId: string) {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  }

  async function createFakeUser(): Promise<string> {
    const id = crypto.randomUUID();
    // Only `id` is required on auth.users; the on_auth_user_created
    // trigger creates the matching public.users row automatically.
    await client.query('insert into auth.users (id) values ($1)', [id]);
    return id;
  }

  /** Inserts a circle + its creator's membership directly (bypassing
   * create_circle) so a test can cheaply set up "already at N-1" state
   * without N sequential RPC round-trips. */
  async function seedCircle(
    creatorId: string,
    opts: { isPublic?: boolean; memberCount?: number } = {}
  ): Promise<{ id: string; inviteCode: string }> {
    const inviteCode = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows } = await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public)
       values ('Fixture Circle', $1, $2, '08:00:00', $3, $4)
       returning id`,
      [practiceId, inviteCode, creatorId, opts.isPublic ?? false]
    );
    const circleId = rows[0].id;
    await client.query(
      "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'owner')",
      [circleId, creatorId]
    );

    const extraMembers = (opts.memberCount ?? 1) - 1;
    for (let i = 0; i < extraMembers; i++) {
      const memberId = await createFakeUser();
      await client.query(
        "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'member')",
        [circleId, memberId]
      );
    }

    return { id: circleId, inviteCode };
  }

  /** Gives `userId` exactly `count` circles via direct inserts — used to
   * put a user "already at the 3-circle cap" before testing a 4th. */
  async function giveUserCircles(userId: string, count: number) {
    for (let i = 0; i < count; i++) {
      await seedCircle(userId);
    }
  }

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    await client.query('BEGIN');

    const { rows } = await client.query(
      'select id, key from public.practices where is_archived = false limit 1'
    );
    if (rows.length === 0) throw new Error('fixture requires at least one non-archived practice');
    practiceId = rows[0].id;
    practiceKey = rows[0].key;
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  test('create_circle rejects a 4th circle for the same user', async () => {
    const user = await createFakeUser();
    await giveUserCircles(user, 2);
    await actAs(user);

    // 3rd circle succeeds
    await expect(
      client.query('select * from create_circle($1, $2, $3, $4)', [
        practiceKey,
        '08:00:00',
        'Circle Three',
        false,
      ])
    ).resolves.toBeDefined();

    // 4th circle is rejected
    await expect(
      client.query('select * from create_circle($1, $2, $3, $4)', [
        practiceKey,
        '08:00:00',
        'Circle Four',
        false,
      ])
    ).rejects.toMatchObject({ message: THREE_CIRCLES_MESSAGE });
  });

  test('join_circle_by_code rejects a 4th circle for the same user, same message as create_circle', async () => {
    const target = await seedCircle(await createFakeUser());
    const user = await createFakeUser();
    await giveUserCircles(user, 3);
    await actAs(user);

    await expect(
      client.query('select join_circle_by_code($1)', [target.inviteCode])
    ).rejects.toMatchObject({ message: THREE_CIRCLES_MESSAGE });
  });

  test('join_public_circle rejects a 4th circle for the same user, same message as the other two', async () => {
    const target = await seedCircle(await createFakeUser(), { isPublic: true });
    const user = await createFakeUser();
    await giveUserCircles(user, 3);
    await actAs(user);

    await expect(
      client.query('select join_public_circle($1)', [target.id])
    ).rejects.toMatchObject({ message: THREE_CIRCLES_MESSAGE });
  });

  test('join_circle_by_code rejects a 13th member; a 12th succeeds first', async () => {
    const creator = await createFakeUser();
    const circle = await seedCircle(creator, { memberCount: 11 });

    const twelfthUser = await createFakeUser();
    await actAs(twelfthUser);
    await expect(client.query('select join_circle_by_code($1)', [circle.inviteCode])).resolves.toBeDefined();

    const thirteenthUser = await createFakeUser();
    await actAs(thirteenthUser);
    await expect(
      client.query('select join_circle_by_code($1)', [circle.inviteCode])
    ).rejects.toMatchObject({ message: CIRCLE_FULL_MESSAGE });
  });

  test('join_public_circle rejects a 13th member, same message as join_circle_by_code', async () => {
    const creator = await createFakeUser();
    const circle = await seedCircle(creator, { isPublic: true, memberCount: 11 });

    const twelfthUser = await createFakeUser();
    await actAs(twelfthUser);
    await expect(client.query('select join_public_circle($1)', [circle.id])).resolves.toBeDefined();

    const thirteenthUser = await createFakeUser();
    await actAs(thirteenthUser);
    await expect(
      client.query('select join_public_circle($1)', [circle.id])
    ).rejects.toMatchObject({ message: CIRCLE_FULL_MESSAGE });
  });
});
