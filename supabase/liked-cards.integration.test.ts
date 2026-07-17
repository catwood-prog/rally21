/**
 * Integration test for PM2's two RPC boundaries (Cat's ruling, 17 July):
 * get_my_liked_cards() — the ONLY client read of card_events (its SELECT
 * policy stays founder-only; no policy widening) — and unlike_card(), a
 * real row deletion of the caller's own liked rows (never a tombstone, so
 * NQ2's nudge like-count respects un-likes automatically).
 *
 * Same connection/rollback pattern as practice-privacy.integration.test.ts:
 * needs SUPABASE_DB_URL (see "Running the RPC-boundary integration tests"
 * in CLAUDE.md), runs in one transaction, always rolled back. The role
 * switch to `authenticated` matters doubly here: it proves the RPCs work
 * for the real PostgREST role AND that the founder-only card_events SELECT
 * still blocks a direct read.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[liked-cards.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

describeIfConfigured('liked cards (PM2 RPC boundaries)', () => {
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

  async function likeAs(userId: string, cardKey: string) {
    await actAs(userId);
    await client.query("select record_card_event('curated_quote', $1, 'liked')", [cardKey]);
  }

  async function likedCardsFor(userId: string): Promise<{ card_key: string; attribution: string | null }[]> {
    await actAs(userId);
    const { rows } = await client.query('select card_key, attribution from get_my_liked_cards()');
    return rows;
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

  test('own likes come back deduped with bank text; non-like events never leak', async () => {
    const user = await createFakeUser();
    await likeAs(user, 'QB-001');
    await likeAs(user, 'QB-001'); // duplicate like of the same card
    await likeAs(user, 'QB-002');
    await actAs(user);
    await client.query("select record_card_event('curated_quote', 'QB-003', 'shown')");

    const rows = await likedCardsFor(user);
    expect(rows.map((r) => r.card_key).sort()).toEqual(['QB-001', 'QB-002']);
  });

  test("another user's likes are invisible; a direct card_events read stays blocked (founder-only)", async () => {
    const liker = await createFakeUser();
    const stranger = await createFakeUser();
    await likeAs(liker, 'QB-005');

    expect((await likedCardsFor(stranger)).length).toBe(0);

    // The RPC is the only door: the table's own SELECT policy still
    // blocks the authenticated role from reading any rows directly.
    await actAs(liker);
    const direct = await client.query('select id from public.card_events');
    expect(direct.rows.length).toBe(0);
  });

  test('unlike_card really deletes every own liked row for the card — and only own rows', async () => {
    const liker = await createFakeUser();
    const other = await createFakeUser();
    await likeAs(liker, 'QB-010');
    await likeAs(liker, 'QB-010'); // duplicate must go too
    await likeAs(liker, 'QB-011');
    await likeAs(other, 'QB-010'); // same card, different owner — must survive

    await actAs(liker);
    await client.query("select unlike_card('QB-010')");

    expect((await likedCardsFor(liker)).map((r) => r.card_key)).toEqual(['QB-011']);
    expect((await likedCardsFor(other)).map((r) => r.card_key)).toEqual(['QB-010']);

    // Deletion is REAL (no tombstone rows left behind) — checked with the
    // elevated role since the table read is founder-only.
    await elevated();
    const { rows } = await client.query(
      "select count(*)::int as n from public.card_events where card_key = 'QB-010' and event = 'liked'"
    );
    expect(rows[0].n).toBe(1); // only the other user's like remains
  });
});
