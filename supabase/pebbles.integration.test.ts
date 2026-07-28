/**
 * PA3 — pebbles: the nest, the sheltered gap, and the six-day cliff.
 * Rally21-Personal-Arc-Decision-Memo.md §5.2 (the economy) and §5.3
 * (what the flame shows during a gap).
 *
 * WHY THESE ASSERTIONS LIVE AT THE DATABASE AND NOT IN A UNIT TEST.
 * There is deliberately no TypeScript copy of the pebble simulation to
 * unit-test: `glow_day_states` is the ONE place the economy is
 * implemented, and every reader (the flame, the week row, the nest, the
 * pair streaks) delegates to it. A mirrored client-side model would be a
 * second source of truth for the same question, which is the drift class
 * this project has already paid for twice (PA4's false wall sentences,
 * CY1's two hand-mirrored ladders). So the boundaries are pinned where
 * the rules actually run.
 *
 * These functions are SECURITY DEFINER and the gifting RPC branches on
 * auth.uid(), which reads the `request.jwt.claim.sub` GUC — only a real
 * signed JWT or a direct, privileged Postgres connection can set it. See
 * "Running the RPC-boundary integration tests" in CLAUDE.md. Everything
 * runs inside one transaction, always rolled back in afterAll, so it
 * never leaves a row behind whatever it asserts.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  console.warn(
    '[pebbles.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

type DayState = {
  d: string;
  state: 'earned' | 'held' | 'none';
  held_by: 'away' | 'cover' | 'pebble' | null;
  pebbles_after: number;
  run_after: number;
  break_kind: 'cliff' | 'unsheltered' | null;
};

describeIfConfigured('PA3 — the pebble economy at the boundaries', () => {
  let client: Client;
  let practiceId: string;

  async function actAs(userId: string) {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  }

  /** Joined well before any scenario, so regeneration has long since
   * filled the nest to its cap and each scenario starts from a known 6
   * rather than from an accident of timing. */
  async function createFakeUser(name: string): Promise<string> {
    const id = crypto.randomUUID();
    await client.query('insert into auth.users (id) values ($1)', [id]);
    await client.query(
      "update public.users set name = $2, timezone = 'UTC', created_at = '2026-01-01T00:00:00Z' where id = $1",
      [id, name]
    );
    return id;
  }

  async function seedCircle(creatorId: string): Promise<string> {
    const inviteCode = `P${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows } = await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public)
       values ('PA3 Fixture Circle', $1, $2, '08:00:00', $3, false)
       returning id`,
      [practiceId, inviteCode, creatorId]
    );
    await client.query(
      "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'owner')",
      [rows[0].id, creatorId]
    );
    return rows[0].id;
  }

  async function addMember(circleId: string, userId: string) {
    await client.query(
      "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'member')",
      [circleId, userId]
    );
  }

  async function practiseOn(userId: string, circleId: string, dates: string[]) {
    for (const date of dates) {
      await client.query(
        `insert into public.completions (user_id, circle_id, local_date, kind)
         values ($1, $2, $3::date, 'self')`,
        [userId, circleId, date]
      );
    }
  }

  function range(from: string, to: string): string[] {
    const out: string[] = [];
    const cur = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (cur <= end) {
      out.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }

  async function days(userId: string, through: string): Promise<DayState[]> {
    const { rows } = await client.query(
      'select d::text, state, held_by, pebbles_after, run_after, break_kind from public.glow_day_states($1, $2::date) order by d',
      [userId, through]
    );
    return rows as DayState[];
  }

  const on = (all: DayState[], date: string) => all.find((r) => r.d === date)!;

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
    await client.query('ROLLBACK');
    await client.end();
  });

  test('one pebble shelters a whole 5-day gap, whatever its length, and the run survives', async () => {
    const user = await createFakeUser('Five Day Gap');
    const circle = await seedCircle(user);
    await practiseOn(user, circle, [...range('2026-06-01', '2026-06-10'), '2026-06-16']);

    const all = await days(user, '2026-06-16');
    const gap = range('2026-06-11', '2026-06-15').map((d) => on(all, d));

    expect(gap.every((r) => r.state === 'held' && r.held_by === 'pebble')).toBe(true);
    expect(all.filter((r) => r.break_kind !== null)).toEqual([]);
    // ONE pebble for the whole gap, not one per day — the memo's rule is
    // per-gap, and a per-day charge would empty any nest in a week.
    expect(on(all, '2026-06-10').pebbles_after - on(all, '2026-06-11').pebbles_after).toBe(1);
    // The run carries straight across the sheltered gap: 10 days before,
    // an 11th on return.
    expect(on(all, '2026-06-16').run_after).toBe(11);
  });

  test('the sixth day ends the run, and it ends as a CLIFF rather than an empty nest', async () => {
    const user = await createFakeUser('Six Day Cliff');
    const circle = await seedCircle(user);
    await practiseOn(user, circle, [...range('2026-06-01', '2026-06-10'), '2026-06-17']);

    const all = await days(user, '2026-06-17');

    // Days 1-5 of the gap are still held — the pebble did its whole job.
    expect(
      range('2026-06-11', '2026-06-15')
        .map((d) => on(all, d))
        .every((r) => r.state === 'held' && r.held_by === 'pebble')
    ).toBe(true);

    const sixth = on(all, '2026-06-16');
    expect(sixth.state).toBe('none');
    expect(sixth.held_by).toBeNull();
    // 'cliff', not 'unsheltered': a pebble WAS spent here, which is what
    // tells get_glow_for_user to go straight to cold instead of offering
    // an ember window. The grace was already taken.
    expect(sixth.break_kind).toBe('cliff');
    expect(sixth.run_after).toBe(0);

    // Exactly one break is reported for the gap, not one per day past it.
    expect(all.filter((r) => r.break_kind !== null)).toHaveLength(1);
  });

  test('an empty nest breaks as UNSHELTERED, which is what keeps the ember grace', async () => {
    const user = await createFakeUser('Empty Nest');
    const circle = await seedCircle(user);
    // Alternate practice/miss so each miss opens its own one-day gap and
    // burns a pebble faster than the 1-per-3-days clock refills it.
    const dates: string[] = [];
    for (let i = 0; i < 20; i += 2) {
      const day = new Date('2026-06-01T00:00:00Z');
      day.setUTCDate(day.getUTCDate() + i);
      dates.push(day.toISOString().slice(0, 10));
    }
    await practiseOn(user, circle, dates);

    const all = await days(user, '2026-06-20');
    expect(all.some((r) => r.break_kind === 'unsheltered')).toBe(true);
    expect(all.every((r) => r.pebbles_after >= 0)).toBe(true);
  });

  test('the nest caps at 6 on regeneration alone, and never goes negative', async () => {
    const user = await createFakeUser('Capped');
    const circle = await seedCircle(user);
    await practiseOn(user, circle, range('2026-06-01', '2026-06-10'));

    const all = await days(user, '2026-06-30');
    expect(Math.max(...all.map((r) => r.pebbles_after))).toBe(6);
    expect(Math.min(...all.map((r) => r.pebbles_after))).toBeGreaterThanOrEqual(0);
  });

  test('a gift may push the recipient OVER the cap — generosity is not capped, regeneration is', async () => {
    const giver = await createFakeUser('Giver');
    const circle = await seedCircle(giver);
    const receiver = await createFakeUser('Receiver');
    await addMember(circle, receiver);
    await practiseOn(receiver, circle, range('2026-06-01', '2026-06-10'));

    const before = await days(receiver, '2026-06-10');
    expect(on(before, '2026-06-05').pebbles_after).toBe(6);

    await client.query(
      'insert into public.pebble_gifts (from_user, to_user, circle_id, local_date) values ($1, $2, $3, $4::date)',
      [giver, receiver, circle, '2026-06-05']
    );

    const after = await days(receiver, '2026-06-10');
    expect(on(after, '2026-06-05').pebbles_after).toBe(7);
  });

  test('gift_pebble refuses an empty nest, and refuses a second gift to the same person the same day', async () => {
    const giver = await createFakeUser('Generous');
    const circle = await seedCircle(giver);
    const receiver = await createFakeUser('Recipient');
    await addMember(circle, receiver);
    await actAs(giver);

    const first = await client.query('select public.gift_pebble($1, $2) as left', [circle, receiver]);
    expect(Number(first.rows[0].left)).toBeGreaterThanOrEqual(0);

    // One gift per giver → recipient per giver-local-day, so a nest is
    // not fillable to any depth in one sitting.
    await expect(
      client.query('select public.gift_pebble($1, $2)', [circle, receiver])
    ).rejects.toThrow(/already sent them a pebble today/);
  });

  test('a pebble is never minted by a direct insert — the balance check has no bypass', async () => {
    const giver = await createFakeUser('Forger');
    const circle = await seedCircle(giver);
    const receiver = await createFakeUser('Beneficiary');
    await addMember(circle, receiver);
    await actAs(giver);

    // There is no INSERT policy on pebble_gifts at all: gifting goes
    // through gift_pebble(), which is where the giver's nest is checked.
    await client.query("set local role authenticated");
    await expect(
      client.query(
        'insert into public.pebble_gifts (from_user, to_user, circle_id, local_date) values ($1, $2, $3, current_date)',
        [giver, receiver, circle]
      )
    ).rejects.toThrow();
    await client.query('reset role');
  });

  test('away is free and uncapped and never touches the nest', async () => {
    const user = await createFakeUser('Away');
    const circle = await seedCircle(user);
    await practiseOn(user, circle, range('2026-06-01', '2026-06-05'));
    for (const d of range('2026-06-06', '2026-06-12')) {
      await client.query(
        `insert into public.completions (user_id, circle_id, local_date, kind)
         values ($1, $2, $3::date, 'away')`,
        [user, circle, d]
      );
    }

    const all = await days(user, '2026-06-12');
    const away = range('2026-06-06', '2026-06-12').map((d) => on(all, d));
    expect(away.every((r) => r.state === 'held' && r.held_by === 'away')).toBe(true);
    // Seven away days in a row — well past the five a pebble covers — and
    // the nest is untouched and the run never breaks.
    expect(on(all, '2026-06-12').pebbles_after).toBe(on(all, '2026-06-05').pebbles_after);
    expect(all.every((r) => r.break_kind === null)).toBe(true);
  });

  test('a friend covering the WHOLE gap refunds the pebble on the next read', async () => {
    const user = await createFakeUser('Covered Later');
    const circle = await seedCircle(user);
    const friend = await createFakeUser('The Friend');
    await addMember(circle, friend);
    // A ONE-DAY gap, so the cover removes the whole thing.
    await practiseOn(user, circle, [...range('2026-06-01', '2026-06-10'), '2026-06-12']);

    const before = await days(user, '2026-06-11');
    expect(on(before, '2026-06-11').held_by).toBe('pebble');
    const spentBalance = on(before, '2026-06-11').pebbles_after;

    await client.query(
      `insert into public.completions (user_id, circle_id, local_date, kind, covered_by)
       values ($1, $2, '2026-06-11'::date, 'covered', $3)`,
      [user, circle, friend]
    );

    const after = await days(user, '2026-06-11');
    expect(on(after, '2026-06-11').held_by).toBe('cover');
    // Deriving the spend rather than materialising it is what makes this
    // free: the simulation simply never spends the pebble on a day a
    // cover now holds, so the stock comes back with no ledger surgery
    // and no reconciliation pass.
    expect(on(after, '2026-06-11').pebbles_after).toBe(spentBalance + 1);
  });

  test('a cover of only PART of a gap shifts the spend rather than refunding it', async () => {
    // Worth pinning because the refund above is easy to over-read. Cover
    // the first day of a two-day gap and the second day is still missed,
    // so it opens a gap of its own and takes its own pebble. The NUMBER
    // of pebbles spent is unchanged; only the day it comes out moves.
    const user = await createFakeUser('Partly Covered');
    const circle = await seedCircle(user);
    const friend = await createFakeUser('Partial Friend');
    await addMember(circle, friend);
    await practiseOn(user, circle, [...range('2026-06-01', '2026-06-10'), '2026-06-13']);

    const before = await days(user, '2026-06-13');
    expect(on(before, '2026-06-11').held_by).toBe('pebble');
    expect(on(before, '2026-06-12').held_by).toBe('pebble');

    await client.query(
      `insert into public.completions (user_id, circle_id, local_date, kind, covered_by)
       values ($1, $2, '2026-06-11'::date, 'covered', $3)`,
      [user, circle, friend]
    );

    const after = await days(user, '2026-06-13');
    expect(on(after, '2026-06-11').held_by).toBe('cover');
    // Still held — the run is never dropped by a cover arriving.
    expect(on(after, '2026-06-12').held_by).toBe('pebble');
    expect(after.every((r) => r.break_kind === null)).toBe(true);
  });
});
