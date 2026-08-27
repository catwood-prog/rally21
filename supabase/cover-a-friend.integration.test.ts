/**
 * Integration test for the cover-a-friend feature's RLS rules on
 * `public.completions`.
 *
 * CV1 (23 July) — cover is a NEXT-DAY rescue of the MISSED day: a member
 * can log a `kind='covered'` completion for a fellow member only for that
 * member's OWN local yesterday (retiring same-day covering), and only
 * under the other rules the spec requires — you can't cover yourself, only
 * members of the circle can cover, you can only cover a fellow member, and
 * one cover per member per missed day (a same-day self completion for that
 * day trips the same NOT EXISTS clause). Fixture dates are relative to
 * now() (fake users default to UTC), since the policy computes "yesterday"
 * from the covered member's stored timezone.
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

describeIfConfigured('cover a friend — RLS on completions (CV1 next-day rescue)', () => {
  let client: Client;
  let practiceId: string;
  // CV1: covers must land on the covered member's local yesterday, so the
  // fixtures use dates derived from now() at the DB (all fake users default
  // to UTC — the policy reads coalesce(timezone,'UTC')).
  let TODAY: string;
  let YESTERDAY: string;
  let TWO_DAYS_AGO: string;
  // CV4 — the missed day's own month, which is the month the shelter
  // counter resets on. Derived at run time, never hardcoded: the flag has
  // to be right on the 1st of a month as much as on the 26th.
  let MONTH_START: string;
  let DAY_OF_MONTH: number;

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

    const { rows: dates } = await client.query(
      `select (now() at time zone 'UTC')::date::text as today,
              ((now() at time zone 'UTC')::date - 1)::text as yesterday,
              ((now() at time zone 'UTC')::date - 2)::text as two_days_ago`
    );
    TODAY = dates[0].today;
    YESTERDAY = dates[0].yesterday;
    TWO_DAYS_AGO = dates[0].two_days_ago;

    const { rows: month } = await client.query(
      `select date_trunc('month', $1::date)::date::text as month_start,
              extract(day from $1::date)::int as day_of_month`,
      [YESTERDAY]
    );
    MONTH_START = month[0].month_start;
    DAY_OF_MONTH = month[0].day_of_month;
  });

  afterAll(async () => {
    await elevated();
    await client.query('ROLLBACK');
    await client.end();
  });

  test('CV1: a member can cover another member for their missed day (yesterday)', async () => {
    const coverer = await createFakeUser();
    const covered = await createFakeUser();
    const circleId = await seedCircle(coverer, [covered]);

    const result = await cover(coverer, covered, circleId, YESTERDAY);
    expect(result.ok).toBe(true);

    await elevated();
    const { rows } = await client.query(
      'select kind, covered_by from public.completions where circle_id = $1 and user_id = $2 and local_date = $3',
      [circleId, covered, YESTERDAY]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('covered');
    expect(rows[0].covered_by).toBe(coverer);
  });

  test('CV1: same-day covering (today) is rejected — same-day covering is retired', async () => {
    const coverer = await createFakeUser();
    const covered = await createFakeUser();
    const circleId = await seedCircle(coverer, [covered]);

    const result = await cover(coverer, covered, circleId, TODAY);
    expect(result.ok).toBe(false);
  });

  test('CV1: covering a day older than yesterday is rejected', async () => {
    const coverer = await createFakeUser();
    const covered = await createFakeUser();
    const circleId = await seedCircle(coverer, [covered]);

    const result = await cover(coverer, covered, circleId, TWO_DAYS_AGO);
    expect(result.ok).toBe(false);
  });

  test('one cover per member per missed day — a second cover for the same person/day is rejected', async () => {
    const coverer = await createFakeUser();
    const secondCoverer = await createFakeUser();
    const covered = await createFakeUser();
    const circleId = await seedCircle(coverer, [secondCoverer, covered]);

    expect((await cover(coverer, covered, circleId, YESTERDAY)).ok).toBe(true);
    const second = await cover(secondCoverer, covered, circleId, YESTERDAY);
    expect(second.ok).toBe(false);
  });

  test('cannot cover someone who already has that missed day done themselves', async () => {
    const coverer = await createFakeUser();
    const covered = await createFakeUser();
    const circleId = await seedCircle(coverer, [covered]);

    await selfCheckin(covered, circleId, YESTERDAY);
    const result = await cover(coverer, covered, circleId, YESTERDAY);
    expect(result.ok).toBe(false);
  });

  test('cannot cover yourself', async () => {
    const user = await createFakeUser();
    const circleId = await seedCircle(user);

    const result = await cover(user, user, circleId, YESTERDAY);
    expect(result.ok).toBe(false);
  });

  test('only members of the circle can cover', async () => {
    const owner = await createFakeUser();
    const covered = await createFakeUser();
    const outsider = await createFakeUser();
    const circleId = await seedCircle(owner, [covered]);

    const result = await cover(outsider, covered, circleId, YESTERDAY);
    expect(result.ok).toBe(false);
  });

  test('cannot cover someone who is not a member of the circle', async () => {
    const coverer = await createFakeUser();
    const nonMember = await createFakeUser();
    const circleId = await seedCircle(coverer);

    const result = await cover(coverer, nonMember, circleId, YESTERDAY);
    expect(result.ok).toBe(false);
  });

  test('a wave posts no completion — the covered member stays uncovered', async () => {
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
      'select * from public.completions where circle_id = $1 and user_id = $2',
      [circleId, target]
    );
    expect(rows).toHaveLength(0);
  });

  test("circle glow sees the covered day, but the covered member's personal (kind=self) history does not", async () => {
    const coverer = await createFakeUser();
    const covered = await createFakeUser();
    const circleId = await seedCircle(coverer, [covered]);

    expect((await cover(coverer, covered, circleId, YESTERDAY)).ok).toBe(true);

    // Mirrors getCirclePresence's unfiltered select — feeds computeSignal,
    // so the circle's glow counts the covered (rescued) day.
    await actAs(covered);
    const { rows: circlePresence } = await client.query(
      'select user_id, kind from public.completions where circle_id = $1 and local_date = $2',
      [circleId, YESTERDAY]
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

  // ── CV4 (27 Aug) — the cover pill carries whether the cover will hold ──
  //
  // THE ORACLE IS glow_day_states ITSELF, and that is the whole design of
  // these two tests. `cover_will_hold` is a PREDICTION about what the live
  // shelter rule will do with a row that does not exist yet, so the only
  // assertion worth making is that the prediction and the outcome agree:
  // read the flag, write the cover, ask glow_day_states what actually
  // happened. A test that merely re-derived `holds < capacity` in
  // TypeScript would be a third copy of the rule, agreeing with itself.

  /** Reads the flag the cover pill would carry for this member. */
  async function coverableFlag(
    covererId: string,
    circleId: string,
    memberId: string
  ): Promise<boolean | undefined> {
    await actAs(covererId);
    const { rows } = await client.query(
      'select user_id, cover_will_hold from public.get_coverable_members($1)',
      [circleId]
    );
    return rows.find((r) => r.user_id === memberId)?.cover_will_hold;
  }

  /** What the shelter rule actually did with the covered day. */
  async function heldByOn(userId: string, localDate: string): Promise<string | null> {
    await elevated();
    const { rows } = await client.query(
      'select held_by from public.glow_day_states($1, $2::date) where d = $2::date',
      [userId, localDate]
    );
    return rows[0]?.held_by ?? null;
  }

  test('CV4: within capacity — the flag says it will hold, and it does', async () => {
    const coverer = await createFakeUser();
    const covered = await createFakeUser();
    const circleId = await seedCircle(coverer, [covered]);
    await selfCheckin(covered, circleId, TWO_DAYS_AGO);

    // The offer is there, and it promises a real hold.
    expect(await coverableFlag(coverer, circleId, covered)).toBe(true);

    expect((await cover(coverer, covered, circleId, YESTERDAY)).ok).toBe(true);
    expect(await heldByOn(covered, YESTERDAY)).toBe('cover');
  });

  test("CV4: past capacity — the offer STAYS (Cat's Option B) and the flag stops promising", async () => {
    const coverer = await createFakeUser();
    const covered = await createFakeUser();
    const circleId = await seedCircle(coverer, [covered]);

    if (DAY_OF_MONTH < 3) {
      // THE FIXTURE CANNOT EXIST ON THE 1st OR 2nd, and that is a fact
      // about the rule rather than a gap in the test: the shelter counter
      // resets with the month, so a missed day that early has no earlier
      // day in its own month to have spent anything. The complementary
      // truth is what gets asserted instead — a fresh month restores
      // capacity, and last month's spent hold does not bleed across.
      await elevated();
      await client.query(
        "insert into public.completions (circle_id, user_id, local_date, kind, covered_by) values ($1, $2, ($3::date - 1), 'covered', $4)",
        [circleId, covered, MONTH_START, coverer]
      );
      await selfCheckin(covered, circleId, TWO_DAYS_AGO);
      expect(await coverableFlag(coverer, circleId, covered)).toBe(true);
      expect((await cover(coverer, covered, circleId, YESTERDAY)).ok).toBe(true);
      expect(await heldByOn(covered, YESTERDAY)).toBe('cover');
      return;
    }

    // One hold already spent earlier in the SAME month (seeded elevated —
    // RLS only ever allows a cover on yesterday, which is the point).
    await elevated();
    await client.query(
      "insert into public.completions (circle_id, user_id, local_date, kind, covered_by) values ($1, $2, $3::date, 'covered', $4)",
      [circleId, covered, MONTH_START, coverer]
    );
    await selfCheckin(covered, circleId, TWO_DAYS_AGO);
    // CONTROL: the spent hold really is a hold. Without this, a fixture
    // that quietly stopped registering would make the assertion below
    // vacuously green — the exact class CV2 found seven of.
    expect(await heldByOn(covered, MONTH_START)).toBe('cover');

    // ELIGIBILITY IS UNCHANGED: they are still offered, still coverable.
    expect(await coverableFlag(coverer, circleId, covered)).toBe(false);
    expect((await cover(coverer, covered, circleId, YESTERDAY)).ok).toBe(true);

    // And the flag told the truth: the cover landed, notified, renders as
    // covered — and held nothing.
    expect(await heldByOn(covered, YESTERDAY)).not.toBe('cover');
  });

  test('CV4 job 3(d): the eligibility functions are byte-for-byte unchanged', async () => {
    await elevated();
    const { rows } = await client.query(
      `select p.proname, md5(p.prosrc) as src_md5
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('ember_window_for', 'find_open_ember_windows')
        order by p.proname`
    );
    // Read from pg_proc at 9c20d4e, BEFORE CV4's migration ran. Cat's
    // ruling keeps the offer wide, so the two functions that decide who is
    // offered a cover must be exactly as they were — this pins that rather
    // than trusting the diff.
    expect(rows).toEqual([
      { proname: 'ember_window_for', src_md5: '7dfbcb3439d8e9cff051d6d03942a1b9' },
      { proname: 'find_open_ember_windows', src_md5: '17249383434c1b583f82f3aa4b937269' },
    ]);
  });

  test('CV4: the rebuilt get_coverable_members is not executable by anon or public', async () => {
    await elevated();
    // A drop-and-create re-opens the door S1 exists to keep shut: Postgres
    // grants EXECUTE to PUBLIC on every new function, and anon inherits it
    // through PUBLIC membership. The migration revokes explicitly; this
    // reads the ACL back rather than trusting that it did.
    const { rows } = await client.query(
      `select coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_exec,
              coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as auth_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_coverable_members'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].anon_exec).toBe(false);
    expect(rows[0].auth_exec).toBe(true);
  });
});
