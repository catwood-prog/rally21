/**
 * PA4 — the rally milestone's wall event, and the friend streak that
 * outlives the circle. Rally21-Personal-Arc-Decision-Memo.md §5.1, §6.
 *
 * THE TEST THIS SUITE EXISTS FOR IS THE FIRST ONE. On 28 July, minutes
 * after PA4 shipped, two false sentences appeared on two real circle
 * walls — "Cathy S has rallied 21 practices 🎉" for circles where she
 * had eight practices and four. A pre-PA1 client (the ceremony was
 * gated on the CIRCLE'S AGE back then, and both circles were past day
 * 21) called mark_celebration_seen(circle, 21), and the function
 * composed a public sentence out of a number it had never checked.
 *
 * A unit test could not have caught it: the bug lives in the gap
 * between a client that computes the ladder and a server that trusted
 * it. This suite closes that gap at the RPC boundary, where it is real.
 *
 * These RPCs are SECURITY DEFINER and branch on auth.uid(), which reads
 * the `request.jwt.claim.sub` GUC — only a real signed JWT or a direct,
 * privileged Postgres connection can set it, so this needs a direct
 * connection. See "Running the RPC-boundary integration tests" in
 * CLAUDE.md. Everything runs inside one transaction, always rolled back
 * in afterAll, so it never leaves a row behind whatever it asserts.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  console.warn(
    '[rally-milestone.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

describeIfConfigured('PA4 — a rally milestone must be earned before it reaches a wall', () => {
  let client: Client;
  let practiceId: string;

  async function actAs(userId: string) {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  }

  async function createFakeUser(name: string): Promise<string> {
    const id = crypto.randomUUID();
    await client.query('insert into auth.users (id) values ($1)', [id]);
    // The on_auth_user_created trigger makes the public.users row; the
    // name matters here because the wall copy interpolates it.
    await client.query('update public.users set name = $2, timezone = $3 where id = $1', [
      id,
      name,
      'America/New_York',
    ]);
    return id;
  }

  async function seedCircle(creatorId: string): Promise<string> {
    const inviteCode = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows } = await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public)
       values ('PA4 Fixture Circle', $1, $2, '08:00:00', $3, false)
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

  /** `count` consecutive practice days ending on `lastDate`, all
   * kind='self' — PA1's counting rule is distinct local dates. */
  async function givePractices(
    userId: string,
    circleId: string,
    count: number,
    lastDate = '2026-07-20'
  ) {
    for (let i = 0; i < count; i++) {
      await client.query(
        `insert into public.completions (user_id, circle_id, local_date, kind)
         values ($1, $2, $3::date - $4::int, 'self')`,
        [userId, circleId, lastDate, i]
      );
    }
  }

  async function milestoneBodies(circleId: string): Promise<string[]> {
    const { rows } = await client.query(
      "select body from public.wall_messages where circle_id = $1 and kind = 'milestone' order by created_at",
      [circleId]
    );
    return rows.map((r) => r.body as string);
  }

  async function marker(circleId: string, userId: string): Promise<number> {
    const { rows } = await client.query(
      'select last_celebrated_day from public.memberships where circle_id = $1 and user_id = $2',
      [circleId, userId]
    );
    return rows[0].last_celebrated_day as number;
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
    await client.query('ROLLBACK');
    await client.end();
  });

  test('THE LIVE INCIDENT: a stale client claiming 21 with 8 practices posts nothing and burns nothing', async () => {
    const user = await createFakeUser('Stale Client');
    const circle = await seedCircle(user);
    await givePractices(user, circle, 8);
    await actAs(user);

    // Exactly the call a pre-PA1 bundle makes from the ceremony.
    await client.query('select mark_celebration_seen($1, 21)', [circle]);

    expect(await milestoneBodies(circle)).toEqual([]);
    // The marker matters as much as the wall: left at 21 it is PA1's
    // suppressor and would eat this member's REAL 21st-practice
    // ceremony permanently.
    expect(await marker(circle, user)).toBe(0);
  });

  test('one practice short is still short — the boundary is exact, not lenient', async () => {
    const user = await createFakeUser('Nearly There');
    const circle = await seedCircle(user);
    await givePractices(user, circle, 20);
    await actAs(user);

    await client.query('select mark_celebration_seen($1, 21)', [circle]);
    expect(await milestoneBodies(circle)).toEqual([]);
    expect(await marker(circle, user)).toBe(0);
  });

  test('an earned milestone posts, names the number, and advances the marker', async () => {
    const user = await createFakeUser('Earned It');
    const circle = await seedCircle(user);
    await givePractices(user, circle, 21);
    await actAs(user);

    await client.query('select mark_celebration_seen($1, 21)', [circle]);
    expect(await milestoneBodies(circle)).toEqual(['Earned It has rallied 21 practices 🎉']);
    expect(await marker(circle, user)).toBe(21);
  });

  test('covers never buy a milestone — they protect the glow, never the rally', async () => {
    const user = await createFakeUser('Covered Often');
    const friend = await createFakeUser('The Coverer');
    const circle = await seedCircle(user);
    await addMember(circle, friend);
    await givePractices(user, circle, 15);
    // Six covered days on top: 21 rows, but only 15 practices.
    for (let i = 0; i < 6; i++) {
      await client.query(
        `insert into public.completions (user_id, circle_id, local_date, kind, covered_by)
         values ($1, $2, '2026-07-21'::date + $3::int, 'covered', $4)`,
        [user, circle, i, friend]
      );
    }
    await actAs(user);

    await client.query('select mark_celebration_seen($1, 21)', [circle]);
    expect(await milestoneBodies(circle)).toEqual([]);
  });

  test('replaying the same milestone posts once, however many times it is called', async () => {
    const user = await createFakeUser('Double Tap');
    const circle = await seedCircle(user);
    await givePractices(user, circle, 21);
    await actAs(user);

    await client.query('select mark_celebration_seen($1, 21)', [circle]);
    await client.query('select mark_celebration_seen($1, 21)', [circle]);
    await client.query('select mark_celebration_seen($1, 21)', [circle]);
    expect(await milestoneBodies(circle)).toHaveLength(1);
  });

  test('SYNCHRONISED RALLIES: same first CHECK-IN day, and both past the milestone, celebrate together', async () => {
    const a = await createFakeUser('Ada');
    const b = await createFakeUser('Bo');
    const circle = await seedCircle(a);
    await addMember(circle, b);
    // Both start 2026-07-01; Bo has more, so Ada arriving second is the
    // moment the pair completes.
    await givePractices(b, circle, 22, '2026-07-22');
    await givePractices(a, circle, 21, '2026-07-21');
    await actAs(a);

    await client.query('select mark_celebration_seen($1, 21)', [circle]);
    expect(await milestoneBodies(circle)).toEqual([
      'Ada and Bo have each rallied 21 practices 🎉 — they started the same day, July 1',
    ]);
  });

  test('a co-starter who has NOT reached the milestone is never named — that would publish a comparison', async () => {
    const a = await createFakeUser('Ada');
    const b = await createFakeUser('Behind');
    const circle = await seedCircle(a);
    await addMember(circle, b);
    await givePractices(a, circle, 21, '2026-07-21');
    // Same start day, fewer practices.
    await givePractices(b, circle, 5, '2026-07-05');
    await actAs(a);

    await client.query('select mark_celebration_seen($1, 21)', [circle]);
    const bodies = await milestoneBodies(circle);
    expect(bodies).toEqual(['Ada has rallied 21 practices 🎉']);
    expect(bodies[0]).not.toContain('Behind');
  });

  test('one day apart is not the same day — strictness is the point, no fuzzy window', async () => {
    const a = await createFakeUser('Ada');
    const b = await createFakeUser('One Day Late');
    const circle = await seedCircle(a);
    await addMember(circle, b);
    await givePractices(a, circle, 21, '2026-07-21');
    await givePractices(b, circle, 21, '2026-07-22'); // starts 2 July, not 1
    await actAs(a);

    await client.query('select mark_celebration_seen($1, 21)', [circle]);
    expect(await milestoneBodies(circle)).toEqual(['Ada has rallied 21 practices 🎉']);
  });

  test('the milestone is unforgeable from a client — only the definer path writes the kind', async () => {
    const user = await createFakeUser('Forger');
    const circle = await seedCircle(user);
    await actAs(user);
    await client.query('set local role authenticated');
    await expect(
      client.query(
        `insert into public.wall_messages (circle_id, user_id, body, kind)
         values ($1, $2, 'Forger has rallied 100 practices 🎉', 'milestone')`,
        [circle, user]
      )
    ).rejects.toThrow();
    await client.query('set local role postgres');
  });
});

describeIfConfigured('PA4 — a friend streak outlives the circle that formed it', () => {
  let client: Client;
  let practiceId: string;

  async function actAs(userId: string) {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  }

  async function createFakeUser(name: string): Promise<string> {
    const id = crypto.randomUUID();
    await client.query('insert into auth.users (id) values ($1)', [id]);
    await client.query('update public.users set name = $2, timezone = $3 where id = $1', [
      id,
      name,
      'America/New_York',
    ]);
    return id;
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
    await client.query('ROLLBACK');
    await client.end();
  });

  async function seedPair(): Promise<{ a: string; b: string; circle: string }> {
    const a = await createFakeUser('Ada');
    const b = await createFakeUser('Bo');
    const inviteCode = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows } = await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public)
       values ('PA4 Pair Circle', $1, $2, '08:00:00', $3, false) returning id`,
      [practiceId, inviteCode, a]
    );
    const circle = rows[0].id;
    for (const [u, role] of [
      [a, 'owner'],
      [b, 'member'],
    ] as const) {
      await client.query(
        'insert into public.memberships (circle_id, user_id, role) values ($1, $2, $3)',
        [circle, u, role]
      );
    }
    // Five shared days for both.
    //
    // THE 5 BELOW IS ED1-LOAD-BEARING, not just a fixture count (28 July).
    // These users then miss every day up to current_date, and PA3's
    // pebble shelters the first five of that gap — so between PA3 landing
    // and ED1 landing the same night, every days_together assertion in
    // this file silently read 10, and would have kept reading 10 with
    // nobody noticing, since these suites skip without SUPABASE_DB_URL.
    // ED1 excluded pebble-held days from the pair series and put it back
    // to 5. If a future change to the economy moves this number again,
    // that is the ruling breaking, not the fixture drifting.
    for (const u of [a, b]) {
      for (let i = 0; i < 5; i++) {
        await client.query(
          `insert into public.completions (user_id, circle_id, local_date, kind)
           values ($1, $2, '2026-07-10'::date + $3::int, 'self')`,
          [u, circle, i]
        );
      }
    }
    return { a, b, circle };
  }

  test('the cumulative number survives the other member leaving the circle', async () => {
    const { a, b, circle } = await seedPair();
    await actAs(a);

    const before = await client.query('select * from get_pair_streaks($1)', [circle]);
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0].days_together).toBe(5);
    expect(before.rows[0].shared_this_circle).toBe(true);

    // Bo leaves exactly as leave_circle does: the membership row is
    // hard-deleted, the completions survive.
    await client.query('delete from public.memberships where circle_id = $1 and user_id = $2', [
      circle,
      b,
    ]);

    const after = await client.query('select * from get_pair_streaks($1)', [circle]);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].days_together).toBe(5);
    expect(after.rows[0].shared_this_circle).toBe(true);
  });

  test('a non-member gets nothing at all, not an empty list', async () => {
    const { circle } = await seedPair();
    const stranger = await createFakeUser('Stranger');
    await actAs(stranger);
    await expect(client.query('select * from get_pair_streaks($1)', [circle])).rejects.toThrow(
      /not a member of this circle/
    );
  });

  test('the cumulative number never falls when the consecutive run breaks', async () => {
    const { a, circle } = await seedPair();
    await actAs(a);
    const { rows } = await client.query('select * from get_pair_streaks($1)', [circle]);
    // The last shared day is 2026-07-14, long past, so the run is over.
    expect(rows[0].streak).toBe(0);
    // …and the friendship's number is untouched by that.
    expect(rows[0].days_together).toBe(5);
  });
});
