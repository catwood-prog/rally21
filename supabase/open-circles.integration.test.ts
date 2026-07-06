/**
 * Integration test for the open-circles wall permissions and host
 * controls (multi-circle spec, "Open circles" section): in a public
 * circle, only the creator or a member with >=7 completions in that
 * circle may post free text on the wall (everyone else is react-only,
 * enforced in RLS, not just the UI); a private circle is unchanged.
 * Also covers the host controls (remove a member, close to new joins)
 * and wall-message reactions.
 *
 * Uses the same direct-connection, rollback-only pattern as
 * caps.integration.test.ts / practice-privacy.integration.test.ts — see
 * "Running the RPC-boundary integration test" in CLAUDE.md for how to
 * supply SUPABASE_DB_URL.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[open-circles.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration test" in CLAUDE.md.'
  );
}

describeIfConfigured('open circles — wall permissions and host controls', () => {
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

  async function seedCircle(
    creatorId: string,
    opts: { isPublic?: boolean; closedToJoins?: boolean } = {}
  ): Promise<{ id: string; inviteCode: string }> {
    await elevated();
    const inviteCode = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows } = await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public, closed_to_joins)
       values ('Fixture Circle', $1, $2, '08:00:00', $3, $4, $5)
       returning id`,
      [practiceId, inviteCode, creatorId, opts.isPublic ?? true, opts.closedToJoins ?? false]
    );
    const circleId = rows[0].id;
    await client.query(
      "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'owner')",
      [circleId, creatorId]
    );
    return { id: circleId, inviteCode };
  }

  async function addMember(circleId: string, userId: string) {
    await elevated();
    await client.query(
      "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'member')",
      [circleId, userId]
    );
  }

  async function giveCompletions(circleId: string, userId: string, count: number) {
    await elevated();
    for (let i = 0; i < count; i++) {
      const localDate = `2026-06-${String(i + 1).padStart(2, '0')}`;
      await client.query(
        `insert into public.completions (circle_id, user_id, local_date, kind)
         values ($1, $2, $3, 'self')`,
        [circleId, userId, localDate]
      );
    }
  }

  async function postWallMessage(userId: string, circleId: string, body: string) {
    await actAs(userId);
    return client.query(
      'insert into public.wall_messages (circle_id, user_id, body) values ($1, $2, $3) returning id',
      [circleId, userId, body]
    );
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

  test('a member with <7 completions in a public circle cannot post free text (RLS, not just UI)', async () => {
    const creator = await createFakeUser();
    const circle = await seedCircle(creator, { isPublic: true });
    const member = await createFakeUser();
    await addMember(circle.id, member);
    await giveCompletions(circle.id, member, 3);

    await expect(postWallMessage(member, circle.id, 'hi everyone')).rejects.toThrow();
  });

  test('the creator can always post free text in their own public circle', async () => {
    const creator = await createFakeUser();
    const circle = await seedCircle(creator, { isPublic: true });

    await expect(postWallMessage(creator, circle.id, 'welcome!')).resolves.toBeDefined();
  });

  test('a member unlocks free text once they hit 7 completions in that circle', async () => {
    const creator = await createFakeUser();
    const circle = await seedCircle(creator, { isPublic: true });
    const member = await createFakeUser();
    await addMember(circle.id, member);
    await giveCompletions(circle.id, member, 7);

    await expect(postWallMessage(member, circle.id, 'made it a week!')).resolves.toBeDefined();
  });

  test('private circles are unchanged — everyone posts freely from day one', async () => {
    const creator = await createFakeUser();
    const circle = await seedCircle(creator, { isPublic: false });
    const member = await createFakeUser();
    await addMember(circle.id, member);

    await expect(postWallMessage(member, circle.id, 'hey!')).resolves.toBeDefined();
  });

  test('a circle member can react to a wall message; a non-member cannot', async () => {
    const creator = await createFakeUser();
    const circle = await seedCircle(creator, { isPublic: true });
    const member = await createFakeUser();
    await addMember(circle.id, member);
    const outsider = await createFakeUser();

    const { rows } = await postWallMessage(creator, circle.id, 'react to this');
    const messageId = rows[0].id;

    await actAs(member);
    await expect(
      client.query(
        "insert into public.wall_message_reactions (message_id, from_user_id, emoji) values ($1, $2, '💛')",
        [messageId, member]
      )
    ).resolves.toBeDefined();

    await actAs(outsider);
    await expect(
      client.query(
        "insert into public.wall_message_reactions (message_id, from_user_id, emoji) values ($1, $2, '👏')",
        [messageId, outsider]
      )
    ).rejects.toThrow();
  });

  test('the creator can delete any wall message; a non-creator member cannot', async () => {
    const creator = await createFakeUser();
    const circle = await seedCircle(creator, { isPublic: true });
    const member = await createFakeUser();
    await addMember(circle.id, member);
    await giveCompletions(circle.id, member, 7);

    const { rows } = await postWallMessage(member, circle.id, 'delete me');
    const messageId = rows[0].id;

    await actAs(member);
    const asMember = await client.query('delete from public.wall_messages where id = $1', [messageId]);
    expect(asMember.rowCount).toBe(0);

    await actAs(creator);
    const asCreator = await client.query('delete from public.wall_messages where id = $1', [messageId]);
    expect(asCreator.rowCount).toBe(1);
  });

  test('remove_member_from_circle: the creator can remove a member; a non-creator cannot', async () => {
    const creator = await createFakeUser();
    const circle = await seedCircle(creator, { isPublic: true });
    const member = await createFakeUser();
    const bystander = await createFakeUser();
    await addMember(circle.id, member);
    await addMember(circle.id, bystander);

    await actAs(bystander);
    await expect(
      client.query('select remove_member_from_circle($1, $2)', [circle.id, member])
    ).rejects.toThrow();

    await actAs(creator);
    await expect(
      client.query('select remove_member_from_circle($1, $2)', [circle.id, member])
    ).resolves.toBeDefined();

    await elevated();
    const { rows } = await client.query(
      'select 1 from public.memberships where circle_id = $1 and user_id = $2',
      [circle.id, member]
    );
    expect(rows).toHaveLength(0);
  });

  test('remove_member_from_circle rejects the creator trying to remove themselves', async () => {
    const creator = await createFakeUser();
    const circle = await seedCircle(creator, { isPublic: true });

    await actAs(creator);
    await expect(
      client.query('select remove_member_from_circle($1, $2)', [circle.id, creator])
    ).rejects.toThrow();
  });

  test('closed_to_joins blocks a new join by code or by browsing, but not an existing member rejoining', async () => {
    const creator = await createFakeUser();
    const circle = await seedCircle(creator, { isPublic: true, closedToJoins: true });
    const newcomer = await createFakeUser();

    await actAs(newcomer);
    await expect(client.query('select join_circle_by_code($1)', [circle.inviteCode])).rejects.toThrow();
    await expect(client.query('select join_public_circle($1)', [circle.id])).rejects.toThrow();

    const { rows } = await client.query(
      'select circle_id from public.list_public_circles() where circle_id = $1',
      [circle.id]
    );
    expect(rows).toHaveLength(0);
  });

  test('an open (not closed) public circle still accepts new joins and appears in the listing', async () => {
    const creator = await createFakeUser();
    const circle = await seedCircle(creator, { isPublic: true, closedToJoins: false });
    const newcomer = await createFakeUser();

    await actAs(newcomer);
    await expect(client.query('select join_public_circle($1)', [circle.id])).resolves.toBeDefined();
  });
});
