/**
 * Integration test for the S1 security hardening pass (see
 * ../../Rally21-Security-Spec.md — the source of truth this suite checks
 * against): anon/authenticated function grants, the scoped users/practices
 * read policies, send_friend_nudge's server-side composition + guards,
 * and the full delete_account_prep circle/practice matrix plus the
 * FK-cascade behavior a real account deletion relies on.
 *
 * Same direct-connection, rollback-only pattern as the other RPC-boundary
 * suites — see "Running the RPC-boundary integration test" in CLAUDE.md
 * for how to supply SUPABASE_DB_URL. The deletion tests exercise a real
 * `delete from auth.users` (what auth.admin.deleteUser does at the
 * database level) inside the same rolled-back transaction as everything
 * else here — never committed, so no real account is ever actually lost.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[security-hardening.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration test" in CLAUDE.md.'
  );
}

describeIfConfigured('security hardening (S1)', () => {
  let client: Client;
  let practiceId: string;
  let practiceKey: string;

  async function elevated() {
    await client.query('reset role');
  }

  async function actAs(userId: string) {
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  }

  async function actAsAnon() {
    await client.query('set local role anon');
    await client.query("select set_config('request.jwt.claim.sub', '', true)");
  }

  async function createFakeUser(name: string | null = null): Promise<string> {
    await elevated();
    const id = crypto.randomUUID();
    // handle_new_user (trigger on auth.users) creates the matching
    // public.users + notification_prefs rows automatically.
    await client.query('insert into auth.users (id) values ($1)', [id]);
    if (name) {
      await client.query('update public.users set name = $1 where id = $2', [name, id]);
    }
    return id;
  }

  async function seedCircle(
    creatorId: string,
    opts: { isPublic?: boolean; memberIds?: string[] } = {}
  ): Promise<string> {
    await elevated();
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
    for (const memberId of opts.memberIds ?? []) {
      await client.query(
        "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'member')",
        [circleId, memberId]
      );
    }
    return circleId;
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
    await elevated();
    await client.query('ROLLBACK');
    await client.end();
  });

  describe('function grants', () => {
    const cases: [string, string, unknown[]][] = [
      ['create_circle', 'select * from create_circle($1, $2, $3, $4)', [null, '08:00:00', 'x', false]],
      ['join_public_circle', 'select join_public_circle($1)', [null]],
      ['list_public_circles', 'select * from list_public_circles($1)', [null]],
      ['count_open_circles_by_practice', 'select * from count_open_circles_by_practice()', []],
      ['leave_circle', 'select leave_circle($1)', [null]],
      ['app_caps', 'select * from app_caps()', []],
    ];

    test.each(cases)('%s fails for anon', async (_name, sql, params) => {
      await actAsAnon();
      await expect(client.query(sql, params)).rejects.toThrow();
      await elevated();
    });

    test('a real authenticated call to each still works (spot check: app_caps)', async () => {
      const user = await createFakeUser();
      await actAs(user);
      await expect(client.query('select * from app_caps()')).resolves.toBeDefined();
    });

    test('create_circle works end to end for an authenticated user', async () => {
      const user = await createFakeUser();
      await actAs(user);
      await expect(
        client.query('select * from create_circle($1, $2, $3, $4)', [practiceKey, '08:00:00', 'Grants Test', false])
      ).resolves.toBeDefined();
    });
  });

  describe('users read policy', () => {
    test('a user can always read their own row', async () => {
      const user = await createFakeUser('Self');
      await actAs(user);
      const { rows } = await client.query('select id from public.users where id = $1', [user]);
      expect(rows).toHaveLength(1);
    });

    test('a circle-mate is readable; a non-circle-mate is not', async () => {
      const creator = await createFakeUser('Creator');
      const mate = await createFakeUser('Circle Mate');
      const stranger = await createFakeUser('Stranger');
      await seedCircle(creator, { memberIds: [mate] });

      await actAs(creator);
      const { rows: mateVisible } = await client.query('select id from public.users where id = $1', [mate]);
      expect(mateVisible).toHaveLength(1);

      await actAs(stranger);
      const { rows: mateInvisible } = await client.query('select id from public.users where id = $1', [mate]);
      expect(mateInvisible).toHaveLength(0);
    });

    test('the members embed used by lib/circle.ts still returns names/avatars for circle-mates', async () => {
      const creator = await createFakeUser('Host');
      const mate = await createFakeUser('Member');
      const circleId = await seedCircle(creator, { memberIds: [mate] });

      await actAs(creator);
      const { rows } = await client.query(
        `select m.user_id, u.name from public.memberships m
         join public.users u on u.id = m.user_id
         where m.circle_id = $1`,
        [circleId]
      );
      expect(rows.map((r: any) => r.name).sort()).toEqual(['Host', 'Member']);
    });
  });

  describe('practices read policy', () => {
    test('a seeded system practice is visible to everyone', async () => {
      await elevated();
      const { rows: seeded } = await client.query(
        'select id from public.practices where created_by is null and is_shared = true limit 1'
      );
      expect(seeded.length).toBeGreaterThan(0);

      const someone = await createFakeUser();
      await actAs(someone);
      const { rows } = await client.query('select id from public.practices where id = $1', [seeded[0].id]);
      expect(rows).toHaveLength(1);
    });

    test('a private custom practice is visible only to its creator', async () => {
      const owner = await createFakeUser();
      const viewer = await createFakeUser();
      await actAs(owner);
      const { rows: created } = await client.query(
        "insert into public.practices (name, category, created_by) values ('S1 private practice', 'move', $1) returning id",
        [owner]
      );
      const practiceRowId = created[0].id;

      const { rows: ownerSees } = await client.query('select id from public.practices where id = $1', [practiceRowId]);
      expect(ownerSees).toHaveLength(1);

      await actAs(viewer);
      const { rows: viewerSees } = await client.query('select id from public.practices where id = $1', [practiceRowId]);
      expect(viewerSees).toHaveLength(0);
    });

    test('an orphaned unshared practice (created_by null, is_shared false) is invisible to everyone', async () => {
      await elevated();
      const { rows: orphan } = await client.query(
        "insert into public.practices (name, category, created_by, is_shared) values ('S1 orphan practice', 'move', null, false) returning id"
      );
      const orphanId = orphan[0].id;

      const someone = await createFakeUser();
      await actAs(someone);
      const { rows } = await client.query('select id from public.practices where id = $1', [orphanId]);
      expect(rows).toHaveLength(0);
    });
  });

  describe('send_friend_nudge', () => {
    test('a 3-arg call sends and composes the wall line server-side', async () => {
      const sender = await createFakeUser('Sender');
      const recipient = await createFakeUser('Recipient');
      const circleId = await seedCircle(sender, { memberIds: [recipient] });

      await actAs(sender);
      const localDate = '2026-07-08';
      const { rows } = await client.query(
        'select send_friend_nudge($1, $2, $3) as result',
        [circleId, recipient, localDate]
      );
      expect(rows[0].result).toBe('sent');

      await elevated();
      const { rows: wallRows } = await client.query(
        'select body from public.wall_messages where circle_id = $1 order by created_at desc limit 1',
        [circleId]
      );
      expect(wallRows[0].body).toBe('Sender waved at Recipient 👋');
    });

    test('a member with <7 completions in a public circle can still wave (server-curated content, not the free-text gate)', async () => {
      const sender = await createFakeUser('Waver');
      const recipient = await createFakeUser('Waved At');
      const circleId = await seedCircle(sender, { isPublic: true, memberIds: [recipient] });

      // sender has zero completions in this circle — would fail the
      // free-text wall gate, but a wave is server-composed, not free text.
      await actAs(sender);
      const { rows } = await client.query(
        'select send_friend_nudge($1, $2, $3) as result',
        [circleId, recipient, '2026-07-08']
      );
      expect(rows[0].result).toBe('sent');
    });

    test('crafted HTML in a name never reaches the composed wall line unescaped beyond plain text interpolation', async () => {
      const sender = await createFakeUser('<script>alert(1)</script>');
      const recipient = await createFakeUser('Target');
      const circleId = await seedCircle(sender, { memberIds: [recipient] });

      await actAs(sender);
      await client.query('select send_friend_nudge($1, $2, $3)', [circleId, recipient, '2026-07-08']);

      await elevated();
      const { rows } = await client.query(
        'select payload from public.notification_outbox where user_id = $1 order by created_at desc limit 1',
        [recipient]
      );
      // The RPC only ever composes from a fixed template with the name
      // interpolated as plain text — there is no p_html/p_subject param
      // for a caller to inject a differently-shaped payload into.
      expect(rows[0].payload.senderName).toBe('<script>alert(1)</script>');
      expect(Object.keys(rows[0].payload).sort()).toEqual(['circleName', 'local_date', 'senderName', 'waverId']);
    });

    test('self-nudge, already-checked-in, and opted-out guards are unchanged', async () => {
      const sender = await createFakeUser();
      const recipient = await createFakeUser();
      const circleId = await seedCircle(sender, { memberIds: [recipient] });

      await actAs(sender);
      await expect(
        client.query('select send_friend_nudge($1, $2, $3)', [circleId, sender, '2026-07-08'])
      ).rejects.toThrow(/cannot nudge yourself/);

      await elevated();
      await client.query(
        "insert into public.completions (circle_id, user_id, local_date, kind) values ($1, $2, $3, 'self')",
        [circleId, recipient, '2026-07-09']
      );
      await actAs(sender);
      await expect(
        client.query('select send_friend_nudge($1, $2, $3)', [circleId, recipient, '2026-07-09'])
      ).rejects.toThrow(/already checked in/);

      await elevated();
      await client.query('update public.notification_prefs set friend_nudge_enabled = false where user_id = $1', [
        recipient,
      ]);
      await actAs(sender);
      await expect(
        client.query('select send_friend_nudge($1, $2, $3)', [circleId, recipient, '2026-07-10'])
      ).rejects.toThrow(/nudges disabled/);
    });

    test('pile-on: a second nudge the same day returns already_nudged, not a duplicate send', async () => {
      const senderA = await createFakeUser();
      const senderB = await createFakeUser();
      const recipient = await createFakeUser();
      const circleId = await seedCircle(recipient, { memberIds: [senderA, senderB] });

      await actAs(senderA);
      const { rows: first } = await client.query('select send_friend_nudge($1, $2, $3) as result', [
        circleId,
        recipient,
        '2026-07-11',
      ]);
      expect(first[0].result).toBe('sent');

      await actAs(senderB);
      const { rows: second } = await client.query('select send_friend_nudge($1, $2, $3) as result', [
        circleId,
        recipient,
        '2026-07-11',
      ]);
      expect(second[0].result).toBe('already_nudged');
    });
  });

  describe('delete_account_prep + account deletion cascade', () => {
    test('a hosted circle with other members transfers to the earliest remaining member', async () => {
      const creator = await createFakeUser();
      const earlier = await createFakeUser();
      const later = await createFakeUser();
      const circleId = await seedCircle(creator, { memberIds: [] });
      await client.query("insert into public.memberships (circle_id, user_id, role, joined_at) values ($1, $2, 'member', now() - interval '2 days')", [circleId, earlier]);
      await client.query("insert into public.memberships (circle_id, user_id, role, joined_at) values ($1, $2, 'member', now())", [circleId, later]);

      await client.query('select delete_account_prep($1)', [creator]);

      const { rows } = await client.query('select created_by from public.circles where id = $1', [circleId]);
      expect(rows[0].created_by).toBe(earlier);
    });

    test('a hosted circle with no other members is deleted outright', async () => {
      const creator = await createFakeUser();
      const circleId = await seedCircle(creator);

      await client.query('select delete_account_prep($1)', [creator]);

      const { rows } = await client.query('select id from public.circles where id = $1', [circleId]);
      expect(rows).toHaveLength(0);
    });

    test('the last member of a circle they did not create is deactivated, not deleted', async () => {
      const creator = await createFakeUser();
      const lastMember = await createFakeUser();
      const circleId = await seedCircle(creator, { memberIds: [lastMember] });
      // creator leaves via direct delete so lastMember really is the only one left
      await client.query('delete from public.memberships where circle_id = $1 and user_id = $2', [circleId, creator]);

      await client.query('select delete_account_prep($1)', [lastMember]);

      const { rows } = await client.query('select is_active from public.circles where id = $1', [circleId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].is_active).toBe(false);
    });

    test('practices: an unreferenced custom is deleted, a still-referenced one is orphaned (created_by null)', async () => {
      const owner = await createFakeUser();
      const otherOwner = await createFakeUser();
      await actAs(owner);
      const { rows: unreferenced } = await client.query(
        "insert into public.practices (name, category, created_by) values ('S1 unreferenced', 'move', $1) returning id, key",
        [owner]
      );
      const { rows: referenced } = await client.query(
        "insert into public.practices (name, category, created_by, is_shared) values ('S1 referenced', 'move', $1, true) returning id, key",
        [owner]
      );
      await elevated();
      // a circle owned by someone else still uses the second practice
      await seedCircleUsingPractice(otherOwner, referenced[0].id);

      await client.query('select delete_account_prep($1)', [owner]);

      const { rows: unreferencedAfter } = await client.query('select id from public.practices where id = $1', [
        unreferenced[0].id,
      ]);
      expect(unreferencedAfter).toHaveLength(0);

      const { rows: referencedAfter } = await client.query(
        'select created_by from public.practices where id = $1',
        [referenced[0].id]
      );
      expect(referencedAfter).toHaveLength(1);
      expect(referencedAfter[0].created_by).toBeNull();
    });

    test('idempotent: running prep twice in a row is a no-op the second time', async () => {
      const creator = await createFakeUser();
      const circleId = await seedCircle(creator);

      await client.query('select delete_account_prep($1)', [creator]);
      await expect(client.query('select delete_account_prep($1)', [creator])).resolves.toBeDefined();

      const { rows } = await client.query('select id from public.circles where id = $1', [circleId]);
      expect(rows).toHaveLength(0);
    });

    test('a real deletion (auth.users row gone, matching auth.admin.deleteUser) leaves covered days with covered_by null and cascades the rest', async () => {
      const coveree = await createFakeUser();
      const coverer = await createFakeUser();
      const circleId = await seedCircle(coveree, { memberIds: [coverer] });
      await client.query(
        "insert into public.completions (circle_id, user_id, local_date, kind, covered_by) values ($1, $2, $3, 'covered', $4)",
        [circleId, coveree, '2026-07-12', coverer]
      );

      await client.query('select delete_account_prep($1)', [coverer]);
      // what auth.admin.deleteUser does at the database level — safe here
      // because this whole suite rolls back in afterAll.
      await client.query('delete from auth.users where id = $1', [coverer]);

      const { rows: completionRows } = await client.query(
        'select covered_by from public.completions where circle_id = $1 and local_date = $2',
        [circleId, '2026-07-12']
      );
      expect(completionRows).toHaveLength(1);
      expect(completionRows[0].covered_by).toBeNull();

      const { rows: userRows } = await client.query('select id from public.users where id = $1', [coverer]);
      expect(userRows).toHaveLength(0);

      const { rows: membershipRows } = await client.query(
        'select id from public.memberships where user_id = $1',
        [coverer]
      );
      expect(membershipRows).toHaveLength(0);
    });
  });

  async function seedCircleUsingPractice(creatorId: string, practiceRowId: string): Promise<string> {
    const inviteCode = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows } = await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by)
       values ('Practice Ref Circle', $1, $2, '08:00:00', $3)
       returning id`,
      [practiceRowId, inviteCode, creatorId]
    );
    const circleId = rows[0].id;
    await client.query(
      "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'owner')",
      [circleId, creatorId]
    );
    return circleId;
  }
});
