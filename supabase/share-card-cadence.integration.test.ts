/**
 * SC4 VERIFY 2 — a SOLO user reaches a share card at all, and SC1's
 * "2/week, never two days running" cadence rule is exercised across a
 * simulated fortnight.
 *
 * WHY THIS SUITE EXISTS. The cadence rule lives entirely in SQL
 * (get_share_card_for_today), and until SC4 it had never once been
 * consulted for a single-circle person: the client-side composition
 * ladder returned false whenever the glow beat fired, and the glow beat
 * fires on the first check-in of the day, which for a solo user is every
 * check-in. Six `shown` events across the whole cohort in a month was the
 * measurement. So the rule shipped, was correct, and was unreachable —
 * which is precisely the situation a test written against a TypeScript
 * re-implementation of the rule would have failed to notice. These call
 * the real function.
 *
 * Same connection/rollback pattern as liked-cards.integration.test.ts:
 * needs SUPABASE_DB_URL (see "Running the RPC-boundary integration tests"
 * in CLAUDE.md), runs in one transaction, always rolled back.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[share-card-cadence.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

/** A fortnight of consecutive dates starting on a Monday, so both ISO
 * weeks are whole and the cross-week-boundary adjacency case (a Sunday
 * slot followed by a Monday slot) is actually reachable. */
const FORTNIGHT_START = '2026-08-03'; // a Monday
const FORTNIGHT_DAYS = 14;

function datesFrom(start: string, n: number): string[] {
  const out: string[] = [];
  const [y, m, d] = start.split('-').map(Number);
  for (let i = 0; i < n; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

function isoWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

describeIfConfigured('share card cadence (SC4: a solo user can reach one)', () => {
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

  /** One day of the simulation, exactly as the app now walks it: ask for
   * today's card, and if one comes back, record the 'shown' event the
   * card screen records — which is what consumes the cadence slot. */
  async function liveADay(userId: string, localDate: string): Promise<string | null> {
    await actAs(userId);
    const { rows } = await client.query(
      'select flavor, card_key from get_share_card_for_today($1::date, false, false, $2::int, $3::int)',
      [localDate, 10, 5]
    );
    const card = rows[0];
    if (!card) return null;
    await client.query(
      "insert into card_events (user_id, flavor, card_key, event, created_at) values ($1, $2, $3, 'shown', $4::date)",
      [userId, card.flavor, card.card_key, localDate]
    );
    return localDate;
  }

  async function walkAFortnight(userId: string): Promise<string[]> {
    const served: string[] = [];
    for (const date of datesFrom(FORTNIGHT_START, FORTNIGHT_DAYS)) {
      const got = await liveADay(userId, date);
      if (got) served.push(got);
    }
    return served;
  }

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    await client.query('begin');
  });

  afterAll(async () => {
    await client.query('rollback');
    await client.end();
  });

  it('THE THING THAT WAS IMPOSSIBLE: a solo user reaches a card', async () => {
    const user = await createFakeUser();
    const served = await walkAFortnight(user);
    // Pre-SC4 this number was structurally zero for this person — not
    // because the rule said no, but because the rule was never asked.
    expect(served.length).toBeGreaterThan(0);
  });

  it('never more than two in an ISO week (the weekly cap)', async () => {
    for (let i = 0; i < 8; i++) {
      const user = await createFakeUser();
      const served = await walkAFortnight(user);
      const perWeek = new Map<string, number>();
      for (const date of served) perWeek.set(isoWeek(date), (perWeek.get(isoWeek(date)) ?? 0) + 1);
      for (const count of perWeek.values()) expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('never two days running, including across the ISO week boundary', async () => {
    for (let i = 0; i < 8; i++) {
      const user = await createFakeUser();
      const served = await walkAFortnight(user);
      const seen = new Set(served);
      for (const date of served) expect(seen.has(dayBefore(date))).toBe(false);
    }
  });

  it('is deterministic for a given person and week — asking twice is not two slots', async () => {
    const user = await createFakeUser();
    await actAs(user);
    const ask = () =>
      client.query(
        'select card_key from get_share_card_for_today($1::date, false, false, 10, 5)',
        [FORTNIGHT_START]
      );
    const first = await ask();
    const second = await ask();
    expect(second.rows.length).toBe(first.rows.length);
    // The read is speculative and stable: only the 'shown' event the card
    // screen writes consumes the day, which is what lets checkin-complete
    // prepare a card it may then hand through the glow beat.
    if (first.rows.length) expect(second.rows[0].card_key).toBe(first.rows[0].card_key);
  });

  it('lands around two a week — the rate Cat accepted', async () => {
    let total = 0;
    const people = 10;
    for (let i = 0; i < people; i++) {
      total += (await walkAFortnight(await createFakeUser())).length;
    }
    // Four scheduled slots per fortnight by construction; the only loss is
    // a Sunday slot followed by a Monday one across the week boundary,
    // which the adjacency guard drops (~2% of slots).
    expect(total / people).toBeGreaterThan(3.5);
    expect(total / people).toBeLessThanOrEqual(4);
  });
});
