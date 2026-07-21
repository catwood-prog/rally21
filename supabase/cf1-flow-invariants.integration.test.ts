/**
 * CF1 integration tests — the two flow invariants, pinned at the
 * database boundary:
 *
 * 1. practices.category is DERIVED from practice_type (trigger +
 *    practice_domain_of), so a client-sent category is ignored outright
 *    — the no-client-category rule; and the CHECK constraint behind the
 *    trigger rejects a bad pair even if the trigger is disabled.
 * 2. count_open_circles_by_practice and list_public_circles read ONE
 *    caller-scoped eligibility set (joinable_public_circles), so the
 *    tile count always equals the hub list length — proven across the
 *    joinable / closed-to-joins / already-a-member / full states.
 *
 * Same connection + never-leaves-a-row rollback pattern as the other
 * suites (see "Running the RPC-boundary integration tests" in CLAUDE.md);
 * expected-error checks use SAVEPOINTs so a rejected insert never aborts
 * the suite's single wrapping transaction.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[cf1-flow-invariants.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

describeIfConfigured('CF1 flow invariants', () => {
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

  test('a client-sent category is overwritten by the derived one (insert AND update)', async () => {
    const owner = await createFakeUser();
    await elevated();
    // deliberately wrong: 'read' lives under learn, the client says move
    const { rows } = await client.query(
      "insert into public.practices (name, category, practice_type, created_by) values ('CF1 — derive test', 'move', 'read', $1) returning id, category",
      [owner]
    );
    expect(rows[0].category).toBe('learn');

    // re-typing the practice re-derives the shelf, again ignoring the
    // client's category
    const { rows: updated } = await client.query(
      "update public.practices set practice_type = 'walk', category = 'care' where id = $1 returning category",
      [rows[0].id]
    );
    expect(updated[0].category).toBe('move');
  });

  test('the CHECK behind the trigger rejects a bad pair even with the trigger disabled', async () => {
    const owner = await createFakeUser();
    await elevated();
    await client.query('savepoint cf1_check');
    await client.query(
      'alter table public.practices disable trigger trg_practices_derive_category'
    );
    await expect(
      client.query(
        "insert into public.practices (name, category, practice_type, created_by) values ('CF1 — check test', 'move', 'read', $1)",
        [owner]
      )
    ).rejects.toMatchObject({ code: '23514' }); // check_violation
    await client.query('rollback to savepoint cf1_check'); // also re-enables the trigger
  });

  test('tile count == hub list across joinable / closed / member / full states', async () => {
    const caller = await createFakeUser();
    const host = await createFakeUser();
    await elevated();

    const { rows: pRows } = await client.query(
      "insert into public.practices (name, practice_type, created_by, is_shared) values ('CF1 — count test', 'walk', $1, true) returning id",
      [host]
    );
    const practiceId = pRows[0].id;

    async function circle(name: string, opts: { closed?: boolean } = {}): Promise<string> {
      const { rows } = await client.query(
        `insert into public.circles (name, invite_code, practice_id, created_by, is_public, closed_to_joins)
         values ($1, $2, $3, $4, true, $5) returning id`,
        [name, `CF1${Math.floor(Math.random() * 900 + 100)}${name.length}`, practiceId, host, !!opts.closed]
      );
      await client.query('insert into public.memberships (circle_id, user_id) values ($1, $2)', [
        rows[0].id,
        host,
      ]);
      return rows[0].id;
    }

    await circle('CF1 joinable');
    await circle('CF1 closed', { closed: true });
    const memberOf = await circle('CF1 already member');
    await client.query('insert into public.memberships (circle_id, user_id) values ($1, $2)', [
      memberOf,
      caller,
    ]);
    const full = await circle('CF1 full');
    const { rows: capRows } = await client.query(
      'select max_members_per_circle as cap from public.app_caps()'
    );
    const cap: number = capRows[0].cap;
    for (let i = 1; i < cap; i++) {
      const filler = await createFakeUser();
      await elevated();
      await client.query('insert into public.memberships (circle_id, user_id) values ($1, $2)', [
        full,
        filler,
      ]);
    }

    // the caller's view: exactly ONE circle is genuinely joinable
    await actAs(caller);
    const { rows: countRows } = await client.query(
      'select open_circles from public.count_open_circles_by_practice() where practice_id = $1',
      [practiceId]
    );
    const { rows: listRows } = await client.query(
      'select circle_id, name from public.list_public_circles($1)',
      [practiceId]
    );
    expect(listRows.map((r) => r.name)).toEqual(['CF1 joinable']);
    expect(Number(countRows[0]?.open_circles ?? 0)).toBe(listRows.length);

    // the host's view: their own circles never count for them (they're a
    // member of all four) — count row absent and list empty, agreeing
    await actAs(host);
    const { rows: hostCount } = await client.query(
      'select open_circles from public.count_open_circles_by_practice() where practice_id = $1',
      [practiceId]
    );
    const { rows: hostList } = await client.query(
      'select circle_id from public.list_public_circles($1)',
      [practiceId]
    );
    expect(hostList.length).toBe(0);
    expect(Number(hostCount[0]?.open_circles ?? 0)).toBe(0);
  });
});
