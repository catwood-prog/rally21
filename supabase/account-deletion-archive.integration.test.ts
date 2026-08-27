/**
 * Integration test for HT2 — prep(b) archives what is not the deleter's to
 * delete.
 *
 * FOUND LIVE, NOT HYPOTHESISED. "Breath of Fire & Fists of Anger - morning
 * boost" is inactive, memberless and hosted by a live account, and it holds
 * 23 completions of which 14 belong to ANOTHER account plus 8 wall messages
 * that account wrote. Until HT2, deleting the host's account ran prep(b) —
 * a plain `delete from circles` — and CASCADED all of it away during the
 * deletion of an account that owns none of it. Cat's ruling, 23 Aug: a
 * memberless hosted circle holding rows that are not the deleter's is
 * DEACTIVATED with `closed_to_joins = true` and every row kept; one holding
 * only the deleter's own rows still deletes outright.
 *
 * NOTHING HERE READS A LIVE ROW. The live circle is what forced the ruling;
 * every expected value below comes from a fixture this file built, so the
 * suite cannot go green because production happens to look a certain way.
 *
 * WHAT FAILS AGAINST HEAD: the two archive tests (the ruling's own case,
 * and the two-third-parties case that exercises the other two probes) and
 * the rejoin probe. The two delete tests are NEGATIVE CONTROLS and are
 * deliberately green on both sides — they are what proves the change is a
 * narrow branch rather than "stop deleting circles".
 *
 * Same direct-connection, rollback-only harness as
 * host-handover-on-leave.integration.test.ts — see "Running the RPC-boundary
 * integration tests" in CLAUDE.md for how to supply SUPABASE_DB_URL.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  console.warn(
    '[account-deletion-archive.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

describeIfConfigured("account deletion keeps what is not the deleter's (HT2)", () => {
  let client: Client;
  let practiceId: string;

  async function elevated() {
    await client.query('reset role');
  }

  /** Act as a real signed-in account: the `authenticated` ROLE plus the JWT
   * claim `auth.uid()` reads. A direct connection's default role bypasses
   * both RLS and the column grants, so the switch is not optional. */
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

  /** Branch (b)'s shape: a circle whose creator is its only member. */
  async function seedHostedCircle(creatorId: string): Promise<{ circleId: string; code: string }> {
    await elevated();
    const code = `H${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows } = await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public)
       values ('HT2 Fixture Circle', $1, $2, '08:00:00', $3, false)
       returning id`,
      [practiceId, code, creatorId]
    );
    const circleId = rows[0].id;
    await client.query(
      `insert into public.memberships (circle_id, user_id, role, joined_at)
       values ($1, $2, 'owner', now() - interval '30 days')`,
      [circleId, creatorId]
    );
    return { circleId, code };
  }

  async function addCompletion(circleId: string, userId: string, day: string, coveredBy?: string) {
    await elevated();
    await client.query(
      `insert into public.completions (circle_id, user_id, local_date, kind, covered_by)
       values ($1, $2, $3::date, $4, $5)`,
      [circleId, userId, day, coveredBy ? 'covered' : 'self', coveredBy ?? null]
    );
  }

  async function addWallMessage(
    circleId: string,
    userId: string,
    body: string,
    recipientId?: string
  ) {
    await elevated();
    // `wall_messages_recipient_only_on_warmth` allows a recipient only on
    // the two warmth kinds, so an addressed fixture message is a 'wave'.
    await client.query(
      `insert into public.wall_messages (circle_id, user_id, body, recipient_id, kind)
       values ($1, $2, $3, $4, $5)`,
      [circleId, userId, body, recipientId ?? null, recipientId ? 'wave' : 'post']
    );
  }

  async function addHeart(circleId: string, senderId: string, recipientId: string, day: string) {
    await elevated();
    await client.query(
      `insert into public.friend_hearts (circle_id, sender_id, recipient_id, local_date)
       values ($1, $2, $3, $4::date)`,
      [circleId, senderId, recipientId, day]
    );
  }

  async function addWantActivation(circleId: string, userId: string, key: string) {
    await elevated();
    await client.query(
      `insert into public.want_activations (circle_id, user_id, want_key, want_statement)
       values ($1, $2, $3, 'HT2 fixture want')`,
      [circleId, userId, key]
    );
  }

  /** The circle as it stands, or null when prep deleted it outright. The
   * two outcomes this whole section is about are "row absent" and "row
   * present and inert", so the reader has to be able to tell them apart. */
  async function readCircle(circleId: string) {
    await elevated();
    const { rows } = await client.query(
      'select created_by, is_active, closed_to_joins from public.circles where id = $1',
      [circleId]
    );
    return rows[0] ?? null;
  }

  async function countRows(circleId: string) {
    await elevated();
    const { rows } = await client.query(
      `select
         (select count(*)::int from public.completions      where circle_id = $1) as completions,
         (select count(*)::int from public.wall_messages    where circle_id = $1) as wall_messages,
         (select count(*)::int from public.friend_hearts    where circle_id = $1) as hearts,
         (select count(*)::int from public.want_activations where circle_id = $1) as wants,
         (select count(*)::int from public.memberships      where circle_id = $1) as memberships`,
      [circleId]
    );
    return rows[0];
  }

  async function prepFor(userId: string) {
    await elevated();
    await client.query('select delete_account_prep($1)', [userId]);
  }

  /** The rest of the real deletion path: the edge function calls
   * delete_account_prep and THEN auth.admin.deleteUser, so anything the
   * account's own cascades take is taken here, not by prep. */
  async function finishDeletion(userId: string) {
    await elevated();
    await client.query('delete from auth.users where id = $1', [userId]);
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

  // (a) — FAILS against HEAD, where the circle and both rows are gone.
  test("a memberless hosted circle holding a third party's rows is archived, not deleted", async () => {
    const host = await createFakeUser();
    const third = await createFakeUser();
    const { circleId } = await seedHostedCircle(host);

    // The live shape: someone else took part and has since left, so they
    // are not a member but their history is still in the circle.
    await addCompletion(circleId, third, '2026-08-01');
    await addCompletion(circleId, host, '2026-08-01');
    await addWallMessage(circleId, third, 'HT2 fixture — a third party wrote this');

    await prepFor(host);

    const archived = await readCircle(circleId);
    expect(archived).not.toBeNull();
    expect(archived.is_active).toBe(false);
    expect(archived.closed_to_joins).toBe(true);
    // prep does not touch created_by — that is the auth cascade's job, and
    // handing it over would be inventing a host nobody chose.
    expect(archived.created_by).toBe(host);

    await finishDeletion(host);

    const after = await readCircle(circleId);
    expect(after).not.toBeNull();
    expect(after.created_by).toBeNull();
    expect(after.is_active).toBe(false);
    expect(after.closed_to_joins).toBe(true);

    // The third party keeps everything. The host's own completion and
    // membership go with the host's account, which is correct and is not
    // what this section was about.
    const counts = await countRows(circleId);
    expect(counts.completions).toBe(1);
    expect(counts.wall_messages).toBe(1);
    expect(counts.memberships).toBe(0);

    const { rows } = await client.query(
      'select user_id from public.completions where circle_id = $1',
      [circleId]
    );
    expect(rows.map((r) => r.user_id)).toEqual([third]);
  });

  // (a) — the other two probes, and the one that pins the friend_hearts
  // reading. FAILS against HEAD.
  test("a heart between two other people, or someone else's want, archives the circle too", async () => {
    const host = await createFakeUser();
    const alex = await createFakeUser();
    const sam = await createFakeUser();
    const { circleId: heartCircle } = await seedHostedCircle(host);
    const { circleId: wantCircle } = await seedHostedCircle(host);

    // Neither end of this heart is the deleter, so it survives the account
    // deletion — and prep(b) must not be the thing that destroys it.
    await addHeart(heartCircle, alex, sam, '2026-08-02');
    await addWantActivation(wantCircle, alex, `ht2-fixture-${Math.random().toString(36).slice(2, 8)}`);

    await prepFor(host);
    await finishDeletion(host);

    const heartsArchived = await readCircle(heartCircle);
    expect(heartsArchived).not.toBeNull();
    expect(heartsArchived.is_active).toBe(false);
    expect(heartsArchived.closed_to_joins).toBe(true);
    expect((await countRows(heartCircle)).hearts).toBe(1);

    const wantArchived = await readCircle(wantCircle);
    expect(wantArchived).not.toBeNull();
    expect(wantArchived.is_active).toBe(false);
    expect(wantArchived.closed_to_joins).toBe(true);
    expect((await countRows(wantCircle)).wants).toBe(1);
  });

  // (b) — NEGATIVE CONTROL, green on both sides.
  test("a memberless hosted circle holding only the deleter's own rows is still deleted outright", async () => {
    const host = await createFakeUser();
    const { circleId } = await seedHostedCircle(host);

    await addCompletion(circleId, host, '2026-08-03');
    await addWallMessage(circleId, host, 'HT2 fixture — the host wrote this');

    await prepFor(host);

    expect(await readCircle(circleId)).toBeNull();
    const counts = await countRows(circleId);
    expect(counts.completions).toBe(0);
    expect(counts.wall_messages).toBe(0);
    expect(counts.memberships).toBe(0);
  });

  // (b) — NEGATIVE CONTROL for the ONE JUDGEMENT in HT2, green on both
  // sides. The probes ask "would this row outlive the account deletion?",
  // not "does this row name anybody else". Every row below names a third
  // party but is OWNED by the deleter, and each of the three owning columns
  // is ON DELETE CASCADE to users — so the auth cascade takes all of them
  // regardless. Archiving here would preserve a hostless, joins-closed
  // circle to protect data that no longer exists.
  test('rows the deleter owns do not earn an archive just because they name someone else', async () => {
    const host = await createFakeUser();
    const third = await createFakeUser();
    const { circleId } = await seedHostedCircle(host);

    await addHeart(circleId, host, third, '2026-08-04');
    await addWallMessage(circleId, host, 'HT2 fixture — addressed to a third party', third);
    await addCompletion(circleId, host, '2026-08-04', third);

    await prepFor(host);

    expect(await readCircle(circleId)).toBeNull();
    const counts = await countRows(circleId);
    expect(counts.hearts).toBe(0);
    expect(counts.wall_messages).toBe(0);
    expect(counts.completions).toBe(0);
  });

  // (c) — THE REJOIN PROBE. FAILS against HEAD, where the circle no longer
  // exists and the RPC raises "No circle found for that code" instead.
  //
  // This is the half of the ruling that stops the archive becoming a worse
  // problem than the delete: `circles.created_by` is ON DELETE SET NULL and
  // join_circle_by_code ends with `update circles set is_active = true`, so
  // a deactivate WITHOUT closing joins would let any holder of the invite
  // code mint an ACTIVE circle that nobody can ever host.
  test('the archived circle cannot be rejoined back into life by its invite code', async () => {
    const host = await createFakeUser();
    const third = await createFakeUser();
    const stranger = await createFakeUser();
    const { circleId, code } = await seedHostedCircle(host);

    await addCompletion(circleId, third, '2026-08-05');

    await prepFor(host);
    await finishDeletion(host);

    const archived = await readCircle(circleId);
    expect(archived).not.toBeNull();
    expect(archived.created_by).toBeNull();

    // Last assertion in the test on purpose: a failed statement poisons the
    // transaction until the afterEach savepoint rollback.
    await actAs(stranger);
    await expect(client.query('select join_circle_by_code($1)', [code])).rejects.toThrow(
      /isn.t taking new members/
    );
  });
});
