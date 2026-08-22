/**
 * Integration test for HT1 — a creator's leave hands the circle to the
 * earliest remaining member, the way account deletion already does.
 *
 * The asymmetry this pins down was found live, not hypothesised: Cat's
 * throwaway circle gained a member, its creator left, and the circle ran on
 * with `created_by` pointing at a departed account — so nobody remaining
 * could edit the link or instructions, close it to joins, or set the dose,
 * because HD3 narrowed all four to the creator. `delete_account_prep`(a)
 * has always transferred hostship on account DELETION; `leave_circle`
 * transferred nothing. Cat's ruling, 21 Aug: auto-transfer on leave,
 * mirroring deletion's rule exactly — no prompt, no ceremony.
 *
 * (a) and (c) FAIL against HEAD before the HT1 migration. (b)'s negative
 * controls are green on both sides deliberately: they are what proves the
 * transfer is narrow rather than a blanket rewrite of `created_by`.
 *
 * Same direct-connection, rollback-only harness as
 * security-hardening.integration.test.ts — see "Running the RPC-boundary
 * integration tests" in CLAUDE.md for how to supply SUPABASE_DB_URL.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  // NOTE: the five sibling suites carry an `eslint-disable-next-line
  // no-console` here that the current config reports as UNUSED (the rule
  // does not fire in this scope). Not copied, so this file adds no new
  // warning; the siblings' dead directives are left alone as out of scope.
  console.warn(
    '[host-handover-on-leave.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

describeIfConfigured('a creator leaving hands the circle on (HT1)', () => {
  let client: Client;
  let practiceId: string;

  async function elevated() {
    await client.query('reset role');
  }

  /** Act as a real signed-in account: the `authenticated` ROLE (so RLS and
   * the column grants are actually consulted — a direct connection's default
   * postgres role bypasses both) plus the JWT claim `auth.uid()` reads. */
  async function actAs(userId: string) {
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  }

  async function createFakeUser(): Promise<string> {
    await elevated();
    const id = crypto.randomUUID();
    // handle_new_user (trigger on auth.users) creates the matching
    // public.users + notification_prefs rows automatically.
    await client.query('insert into auth.users (id) values ($1)', [id]);
    return id;
  }

  /** A circle whose creator holds the 'owner' membership, plus any extra
   * members at explicit `joined_at` offsets so successor ordering is
   * deterministic rather than insert-order luck. */
  async function seedCircle(
    creatorId: string,
    members: { userId: string; joinedDaysAgo: number }[] = []
  ): Promise<string> {
    await elevated();
    const inviteCode = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows } = await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public)
       values ('HT1 Fixture Circle', $1, $2, '08:00:00', $3, false)
       returning id`,
      [practiceId, inviteCode, creatorId]
    );
    const circleId = rows[0].id;
    await client.query(
      `insert into public.memberships (circle_id, user_id, role, joined_at)
       values ($1, $2, 'owner', now() - interval '30 days')`,
      [circleId, creatorId]
    );
    for (const m of members) {
      await client.query(
        `insert into public.memberships (circle_id, user_id, role, joined_at)
         values ($1, $2, 'member', now() - ($3 || ' days')::interval)`,
        [circleId, m.userId, String(m.joinedDaysAgo)]
      );
    }
    return circleId;
  }

  async function leaveAs(userId: string, circleId: string) {
    await actAs(userId);
    await client.query('select leave_circle($1)', [circleId]);
  }

  async function readCircle(circleId: string) {
    await elevated();
    const { rows } = await client.query(
      'select created_by, is_active, resource_url, instructions, closed_to_joins, duration_minutes from public.circles where id = $1',
      [circleId]
    );
    return rows[0];
  }

  /**
   * The host test that matters: not "the row says their id" but "the live
   * RLS policy and HD3's four column grants now let them act". Returns the
   * number of rows the UPDATE actually matched — 0 means the policy refused
   * (`created_by = auth.uid()` unmatched), 1 means they really are the host.
   * A 42501 would mean the column grants were revoked, which is a different
   * failure and is allowed to throw rather than be swallowed as 0.
   */
  async function tryHostUpdateAs(userId: string, circleId: string, marker: string): Promise<number> {
    await actAs(userId);
    const res = await client.query(
      `update public.circles
          set resource_url = $2, instructions = $3, closed_to_joins = true, duration_minutes = 17
        where id = $1`,
      [circleId, `https://example.com/${marker}`, `set by ${marker}`]
    );
    return res.rowCount ?? 0;
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

  // (a) — FAILS against HEAD.
  test('the creator leaves a multi-member circle: the earliest remaining member becomes host and can act as one', async () => {
    const creator = await createFakeUser();
    const successor = await createFakeUser();
    const circleId = await seedCircle(creator, [{ userId: successor, joinedDaysAgo: 10 }]);

    // CONTROL, and it is load-bearing: before the leave the successor is an
    // ordinary member, so the very same UPDATE matches ZERO rows. Without
    // this, a passing assertion below could just mean the role switch never
    // took and postgres was writing straight past RLS.
    expect(await tryHostUpdateAs(successor, circleId, 'before')).toBe(0);

    await leaveAs(creator, circleId);

    const after = await readCircle(circleId);
    expect(after.created_by).toBe(successor);
    expect(after.is_active).toBe(true);

    // And prove it through the policy, not just the row.
    expect(await tryHostUpdateAs(successor, circleId, 'after')).toBe(1);

    const edited = await readCircle(circleId);
    expect(edited.resource_url).toBe('https://example.com/after');
    expect(edited.instructions).toBe('set by after');
    expect(edited.closed_to_joins).toBe(true);
    expect(edited.duration_minutes).toBe(17);
  });

  // (b) — NEGATIVE CONTROLS, green both sides.
  test("a non-creator's leave does not touch created_by", async () => {
    const creator = await createFakeUser();
    const member = await createFakeUser();
    const other = await createFakeUser();
    const circleId = await seedCircle(creator, [
      { userId: member, joinedDaysAgo: 10 },
      { userId: other, joinedDaysAgo: 5 },
    ]);

    await leaveAs(member, circleId);

    const after = await readCircle(circleId);
    expect(after.created_by).toBe(creator);
    expect(after.is_active).toBe(true);

    await elevated();
    const { rows } = await client.query(
      'select user_id from public.memberships where circle_id = $1 order by joined_at asc',
      [circleId]
    );
    expect(rows.map((r) => r.user_id)).toEqual([creator, other]);
  });

  // (b) — NEGATIVE CONTROLS, green both sides.
  test("a solo creator's leave deactivates the circle with created_by intact", async () => {
    const creator = await createFakeUser();
    const circleId = await seedCircle(creator);

    await leaveAs(creator, circleId);

    const after = await readCircle(circleId);
    // The dormant-circle precedent: the row, its history and its invite code
    // all survive, and created_by is deliberately NOT nulled — there is
    // nobody to hand it to, and a rejoin flips is_active back.
    expect(after.created_by).toBe(creator);
    expect(after.is_active).toBe(false);

    await elevated();
    const { rows } = await client.query(
      'select count(*)::int as n from public.memberships where circle_id = $1',
      [circleId]
    );
    expect(rows[0].n).toBe(0);
  });

  // (c) — FAILS against HEAD.
  test('with three members the EARLIEST remaining joiner wins, not the most recent', async () => {
    const creator = await createFakeUser();
    const earliest = await createFakeUser();
    const latest = await createFakeUser();
    // Deliberately inserted newest-first, so an implementation that took
    // "the first row it found" rather than the earliest joiner would pick
    // `latest` and fail here.
    const circleId = await seedCircle(creator, [
      { userId: latest, joinedDaysAgo: 1 },
      { userId: earliest, joinedDaysAgo: 20 },
    ]);

    await leaveAs(creator, circleId);

    const after = await readCircle(circleId);
    expect(after.created_by).toBe(earliest);
    expect(after.created_by).not.toBe(latest);
    expect(after.is_active).toBe(true);
  });

  // The mirror rule, stated as one test: the two exits must agree about the
  // same departure. This is what job 1's shared helper buys, and it is the
  // assertion that fails first if a future edit gives either caller its own
  // copy of the successor rule again.
  test('leaving and account-deletion pick the SAME successor for the same circle shape', async () => {
    const shape = async (): Promise<{ creator: string; circleId: string; earliest: string }> => {
      const creator = await createFakeUser();
      const earliest = await createFakeUser();
      const latest = await createFakeUser();
      const circleId = await seedCircle(creator, [
        { userId: latest, joinedDaysAgo: 2 },
        { userId: earliest, joinedDaysAgo: 12 },
      ]);
      return { creator, circleId, earliest };
    };

    const viaLeave = await shape();
    await leaveAs(viaLeave.creator, viaLeave.circleId);

    const viaDeletion = await shape();
    await elevated();
    await client.query('select delete_account_prep($1)', [viaDeletion.creator]);

    const leftCircle = await readCircle(viaLeave.circleId);
    const deletedCircle = await readCircle(viaDeletion.circleId);
    expect(leftCircle.created_by).toBe(viaLeave.earliest);
    expect(deletedCircle.created_by).toBe(viaDeletion.earliest);
  });
});
