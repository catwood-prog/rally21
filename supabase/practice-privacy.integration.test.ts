/**
 * Integration test for the practice-privacy rule: a custom practice is
 * private by default (invisible to everyone but its creator) and only
 * becomes visible to others once a public circle uses it.
 *
 * This is enforced by RLS on the `practices` table's SELECT policy, which
 * only applies when the querying role doesn't bypass row security. A
 * direct Postgres connection typically connects as `postgres` (or
 * whatever role owns the tables), and table owners bypass RLS by default
 * regardless of the `request.jwt.claim.sub` GUC — so this suite explicitly
 * switches to the `authenticated` role (the one PostgREST actually uses
 * for a real signed-in request) before every visibility check. Skipping
 * that switch would silently test nothing, since the owning role can see
 * every row no matter what.
 *
 * See "Running the RPC-boundary integration test" in CLAUDE.md for how to
 * supply SUPABASE_DB_URL — this suite uses the same connection and the
 * same never-leaves-a-row rollback pattern as caps.integration.test.ts.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[practice-privacy.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration test" in CLAUDE.md.'
  );
}

describeIfConfigured('practice privacy', () => {
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
    // Only `id` is required on auth.users; the on_auth_user_created
    // trigger creates the matching public.users row automatically.
    await client.query('insert into auth.users (id) values ($1)', [id]);
    return id;
  }

  async function createPracticeAs(
    userId: string,
    name: string
  ): Promise<{ id: string; key: string }> {
    await elevated();
    const { rows } = await client.query(
      "insert into public.practices (name, category, practice_type, created_by) values ($1, 'move', 'walk', $2) returning id, key",
      [name, userId]
    );
    return rows[0];
  }

  /** Creates a circle via the real RPC (as `creatorId`) rather than a
   * direct insert, so this test also exercises create_circle's
   * "public circle shares its practice" side effect. */
  async function createCircleAs(
    creatorId: string,
    practiceKey: string,
    circleName: string,
    isPublic: boolean
  ): Promise<{ inviteCode: string }> {
    await elevated();
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [creatorId]);
    const { rows } = await client.query('select * from create_circle($1, $2, $3, $4)', [
      practiceKey,
      '08:00:00',
      circleName,
      isPublic,
    ]);
    return { inviteCode: rows[0].invite_code };
  }

  async function isVisibleTo(userId: string, practiceId: string): Promise<boolean> {
    await actAs(userId);
    const { rows } = await client.query('select id from public.practices where id = $1', [practiceId]);
    return rows.length > 0;
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

  test('a private custom practice is invisible to anyone else', async () => {
    const owner = await createFakeUser();
    const viewer = await createFakeUser();
    const practice = await createPracticeAs(owner, 'Privacy Test — private practice');

    await createCircleAs(owner, practice.key, 'Privacy Test Private Circle', false);

    expect(await isVisibleTo(owner, practice.id)).toBe(true);
    expect(await isVisibleTo(viewer, practice.id)).toBe(false);

    await elevated();
    const { rows } = await client.query('select is_shared from public.practices where id = $1', [
      practice.id,
    ]);
    expect(rows[0].is_shared).toBe(false);
  });

  test('a circle member (non-creator) can read their circle\u2019s private custom practice (PT1)', async () => {
    const owner = await createFakeUser();
    const member = await createFakeUser();
    const stranger = await createFakeUser();
    const practice = await createPracticeAs(owner, 'Privacy Test \u2014 circle-mate read');

    const { inviteCode } = await createCircleAs(
      owner,
      practice.key,
      'Privacy Test Member Circle',
      false
    );

    // Before joining: invisible, like any stranger.
    expect(await isVisibleTo(member, practice.id)).toBe(false);

    await actAs(member);
    await client.query('select join_circle_by_code($1)', [inviteCode]);

    // After joining: the circle-member arm of the SELECT policy applies,
    // even though the practice stays is_shared = false.
    expect(await isVisibleTo(member, practice.id)).toBe(true);
    expect(await isVisibleTo(stranger, practice.id)).toBe(false);

    await elevated();
    const { rows } = await client.query('select is_shared from public.practices where id = $1', [
      practice.id,
    ]);
    expect(rows[0].is_shared).toBe(false);
  });

  test('a practice becomes visible to everyone once a public circle uses it', async () => {
    const owner = await createFakeUser();
    const viewer = await createFakeUser();
    const practice = await createPracticeAs(owner, 'Privacy Test — public practice');

    expect(await isVisibleTo(viewer, practice.id)).toBe(false);

    await createCircleAs(owner, practice.key, 'Privacy Test Public Circle', true);

    expect(await isVisibleTo(viewer, practice.id)).toBe(true);

    await elevated();
    const { rows } = await client.query('select is_shared from public.practices where id = $1', [
      practice.id,
    ]);
    expect(rows[0].is_shared).toBe(true);
  });

  test('open-circle counts never reference a practice the caller cannot see', async () => {
    const owner = await createFakeUser();
    const viewer = await createFakeUser();
    const privatePractice = await createPracticeAs(owner, 'Privacy Test — grid check');
    await createCircleAs(owner, privatePractice.key, 'Privacy Test Grid Circle', false);

    await actAs(viewer);
    const { rows } = await client.query(
      `select co.practice_id
       from public.count_open_circles_by_practice() co
       where not exists (select 1 from public.practices p where p.id = co.practice_id)`
    );
    expect(rows).toHaveLength(0);
  });

  test('seeded practices are always visible, regardless of who is asking', async () => {
    await elevated();
    const { rows: seeded } = await client.query(
      'select id from public.practices where created_by is null limit 1'
    );
    expect(seeded.length).toBeGreaterThan(0);

    const someone = await createFakeUser();
    expect(await isVisibleTo(someone, seeded[0].id)).toBe(true);
  });
});
