/**
 * EM1 (9 Aug) — the ember ask's window finder, and the covered notice's
 * trigger.
 *
 * WHAT IS BEING PINNED HERE, and why it is worth a suite of its own: the
 * ask is the app's first PROACTIVE friend-nudge, so every one of its
 * exclusions is a promise about not poking people. An eligible window is
 * one test; the ineligible ones are the feature.
 *
 * THE WINDOW IS NOW ONE DEFINITION (Cat's ruling, 9 Aug), shared by
 * find_open_ember_windows and by CV1's own get_coverable_members, and the
 * two agreeing is itself pinned below. The old ember-state test is gone:
 * since PA3 a gap is pebble-sheltered, so the state stays 'glowing' and
 * the affordance had silently stopped appearing for almost everyone —
 * including, measured, every day of the six-day spell that prompted this
 * section. The nest state is therefore now IRRELEVANT to whether a window
 * is open, which the full-nest and empty-nest tests below both assert.
 *
 * See "Running the RPC-boundary integration tests" in CLAUDE.md for how
 * to supply SUPABASE_DB_URL — same direct-connection, single
 * rolled-back-transaction pattern as cover-a-friend.integration.test.ts.
 * Nothing here writes to public.questions, so the RE2 bank mutex does not
 * apply.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[ember-ask.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration test" in CLAUDE.md.'
  );
}

type Window = {
  asked_user_id: string;
  asked_user_timezone: string;
  missed_user_id: string;
  missed_user_name: string;
  circle_id: string;
  circle_name: string;
  missed_local_date: string;
  spell_day: number;
};

describeIfConfigured('EM1 — open ember windows, and the covered notice', () => {
  let client: Client;
  let practiceId: string;

  async function elevated() {
    await client.query('reset role');
  }

  async function actAs(userId: string) {
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  }

  /** Fake users default to UTC here so every date below is the DB's own. */
  async function createUser(name: string): Promise<string> {
    await elevated();
    const id = crypto.randomUUID();
    await client.query('insert into auth.users (id) values ($1)', [id]);
    await client.query(
      `update public.users
          set name = $2, timezone = 'UTC', created_at = now() - interval '40 days'
        where id = $1`,
      [id, name]
    );
    return id;
  }

  async function seedCircle(creatorId: string, memberIds: string[] = []): Promise<string> {
    await elevated();
    const inviteCode = `E${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows } = await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public)
       values ('Ember Test Circle', $1, $2, '08:00:00', $3, false)
       returning id`,
      [practiceId, inviteCode, creatorId]
    );
    const circleId = rows[0].id;
    await client.query(
      "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'owner')",
      [circleId, creatorId]
    );
    for (const memberId of memberIds) {
      await client.query(
        "insert into public.memberships (circle_id, user_id, role) values ($1, $2, 'member')",
        [circleId, memberId]
      );
    }
    return circleId;
  }

  /** Self check-ins on each day from `fromDaysAgo` down to `toDaysAgo`. */
  async function selfDays(userId: string, circleId: string, fromDaysAgo: number, toDaysAgo: number) {
    await elevated();
    for (let d = fromDaysAgo; d >= toDaysAgo; d--) {
      await client.query(
        `insert into public.completions (circle_id, user_id, local_date, kind)
         values ($1, $2, (now() at time zone 'UTC')::date - $3::int, 'self')`,
        [circleId, userId, d]
      );
    }
  }

  async function coverDay(
    covererId: string,
    coveredId: string,
    circleId: string,
    daysAgo: number
  ) {
    await elevated();
    await client.query(
      `insert into public.completions (circle_id, user_id, local_date, kind, covered_by)
       values ($1, $2, (now() at time zone 'UTC')::date - $3::int, 'covered', $4)`,
      [circleId, coveredId, daysAgo, covererId]
    );
  }

  /**
   * Empties the nest on a given day, so the gap that starts there is
   * UNSHELTERED and the glow really breaks. One gift per pair per day is
   * a unique index, so each unit of drain needs its own throwaway
   * recipient — eight is comfortably more than the cap of six.
   */
  async function drainNest(userId: string, daysAgo: number) {
    await elevated();
    for (let i = 0; i < 8; i++) {
      const sink = await createUser(`sink ${i}`);
      await client.query(
        `insert into public.pebble_gifts (from_user, to_user, local_date)
         values ($1, $2, (now() at time zone 'UTC')::date - $3::int)`,
        [userId, sink, daysAgo]
      );
    }
  }

  async function glowState(userId: string): Promise<string> {
    await elevated();
    const { rows } = await client.query('select state from public.get_glow_for_user($1)', [userId]);
    return rows[0]?.state;
  }

  async function windows(): Promise<Window[]> {
    await elevated();
    const { rows } = await client.query(
      `select asked_user_id, asked_user_timezone, missed_user_id, missed_user_name,
              circle_id, circle_name, missed_local_date::text as missed_local_date, spell_day
         from public.find_open_ember_windows()`
    );
    return rows;
  }

  async function windowsFor(circleId: string): Promise<Window[]> {
    return (await windows()).filter((w) => w.circle_id === circleId);
  }

  async function noticesFor(userId: string) {
    await elevated();
    const { rows } = await client.query(
      `select kind, payload, dedupe_key from public.notification_outbox
        where user_id = $1 and kind = 'covered_notice'`,
      [userId]
    );
    return rows;
  }

  /** CV1's affordance, asked as the mate would ask it from the circle
   * screen. Shares its whole definition with the finder now, so these
   * two must always agree. */
  async function coverableFor(callerId: string, circleId: string) {
    await actAs(callerId);
    const { rows } = await client.query(
      'select user_id, missed_local_date::text as missed_local_date from public.get_coverable_members($1)',
      [circleId]
    );
    await elevated();
    return rows;
  }

  /**
   * The standard fixture: a 28-day run and `missedDays` consecutive
   * missed days ending at the DB's yesterday. The nest is left FULL,
   * which since Cat's 9 Aug ruling is the ordinary case rather than the
   * excluded one.
   */
  async function emberFixture(missedDays: number) {
    const missed = await createUser('Russ');
    const mate = await createUser('Cat');
    const circleId = await seedCircle(mate, [missed]);
    await selfDays(missed, circleId, 30, missedDays + 1);
    return { missed, mate, circleId };
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

  describe('the eligible window', () => {
    test('day 1 of a spell: the circle-mate is asked, about yesterday', async () => {
      const { missed, mate, circleId } = await emberFixture(1);

      const found = await windowsFor(circleId);
      expect(found).toHaveLength(1);
      expect(found[0].asked_user_id).toBe(mate);
      expect(found[0].missed_user_id).toBe(missed);
      expect(found[0].missed_user_name).toBe('Russ');
      expect(found[0].spell_day).toBe(1);

      const { rows: dates } = await client.query(
        `select ((now() at time zone 'UTC')::date - 1)::text as yesterday`
      );
      expect(found[0].missed_local_date).toBe(dates[0].yesterday);
    });

    test('day 2 of a spell: still asked, and the day named is the SECOND missed day', async () => {
      const { circleId } = await emberFixture(2);

      const found = await windowsFor(circleId);
      expect(found).toHaveLength(1);
      expect(found[0].spell_day).toBe(2);

      const { rows: dates } = await client.query(
        `select ((now() at time zone 'UTC')::date - 1)::text as yesterday`
      );
      // CV1's window slides: the coverable day is always the member's own
      // local yesterday, so a day-2 ask targets the second missed day, not
      // the first (which is now out of reach for good).
      expect(found[0].missed_local_date).toBe(dates[0].yesterday);
    });

    test('every other member of the circle is asked, once each', async () => {
      const missed = await createUser('Russ');
      const mateA = await createUser('Cat');
      const mateB = await createUser('Sam');
      const circleId = await seedCircle(mateA, [missed, mateB]);
      await selfDays(missed, circleId, 30, 2);

      const found = await windowsFor(circleId);
      expect(found.map((w) => w.asked_user_id).sort()).toEqual([mateA, mateB].sort());
      // Never about themselves.
      expect(found.some((w) => w.asked_user_id === missed)).toBe(false);
    });
  });

  describe('ONE definition — the ask and the cover pill can never disagree', () => {
    test('a full nest is now irrelevant: the window is open and the pill is shown', async () => {
      const { missed, mate, circleId } = await emberFixture(1);

      // The nest is untouched, so PA3 shelters the day and the flame
      // reads as if nothing happened. Before Cat's 9 Aug ruling this was
      // the case where BOTH readers went silent.
      expect(await glowState(missed)).toBe('glowing');

      const found = await windowsFor(circleId);
      expect(found).toHaveLength(1);
      const coverable = await coverableFor(mate, circleId);
      expect(coverable).toHaveLength(1);
      expect(coverable[0].user_id).toBe(missed);
      expect(coverable[0].missed_local_date).toBe(found[0].missed_local_date);
    });

    test('an empty nest (the old ember state) is open too — same answer, both readers', async () => {
      const { missed, mate, circleId } = await emberFixture(1);
      await drainNest(missed, 1);

      expect(await glowState(missed)).toBe('embers');

      const found = await windowsFor(circleId);
      expect(found).toHaveLength(1);
      const coverable = await coverableFor(mate, circleId);
      expect(coverable.map((r) => r.user_id)).toEqual([missed]);
    });

    test('every exclusion the finder makes, the pill makes too', async () => {
      const { missed, mate, circleId } = await emberFixture(1);
      await coverDay(mate, missed, circleId, 1);

      expect(await windowsFor(circleId)).toEqual([]);
      expect(await coverableFor(mate, circleId)).toEqual([]);
    });

    test('a non-member asking gets nothing, never an error that confirms the circle', async () => {
      const { circleId } = await emberFixture(1);
      const outsider = await createUser('Outsider');

      expect(await coverableFor(outsider, circleId)).toEqual([]);
    });
  });

  describe('the exclusions — each one a promise about not poking people', () => {
    test('already covered for the missed day: no ask', async () => {
      const { missed, mate, circleId } = await emberFixture(1);
      await coverDay(mate, missed, circleId, 1);
      expect(await windowsFor(circleId)).toEqual([]);
    });

    test("they did yesterday themselves: no ask", async () => {
      const missed = await createUser('Russ');
      const mate = await createUser('Cat');
      const circleId = await seedCircle(mate, [missed]);
      await selfDays(missed, circleId, 30, 1);
      expect(await windowsFor(circleId)).toEqual([]);
    });

    test('away is a total pause: the away member is never asked ABOUT', async () => {
      const { missed, circleId } = await emberFixture(1);
      await elevated();
      await client.query('update public.users set away_since = now() where id = $1', [missed]);
      expect(await windowsFor(circleId)).toEqual([]);
    });

    test('an away circle-mate is never asked TO cover', async () => {
      const { mate, circleId } = await emberFixture(1);
      await elevated();
      await client.query('update public.users set away_since = now() where id = $1', [mate]);
      expect(await windowsFor(circleId)).toEqual([]);
    });

    test('a finished circle asks nobody anything', async () => {
      const { circleId } = await emberFixture(1);
      await elevated();
      await client.query('update public.circles set completed_at = now() where id = $1', [circleId]);
      expect(await windowsFor(circleId)).toEqual([]);
    });

    test('an inactive circle asks nobody anything', async () => {
      const { circleId } = await emberFixture(1);
      await elevated();
      await client.query('update public.circles set is_active = false where id = $1', [circleId]);
      expect(await windowsFor(circleId)).toEqual([]);
    });

    test('a block stops the ask in BOTH directions (MOD1)', async () => {
      const forward = await emberFixture(1);
      await elevated();
      await client.query(
        'insert into public.blocks (blocker_id, blocked_id) values ($1, $2)',
        [forward.mate, forward.missed]
      );
      expect(await windowsFor(forward.circleId)).toEqual([]);

      const reverse = await emberFixture(1);
      await elevated();
      await client.query(
        'insert into public.blocks (blocker_id, blocked_id) values ($1, $2)',
        [reverse.missed, reverse.mate]
      );
      expect(await windowsFor(reverse.circleId)).toEqual([]);
    });

    test('somebody who has never checked in has no rally to rescue', async () => {
      const missed = await createUser('Russ');
      const mate = await createUser('Cat');
      const circleId = await seedCircle(mate, [missed]);
      // No completions at all — a brand-new joiner is not "missing" days.
      expect(await windowsFor(circleId)).toEqual([]);
      expect(await coverableFor(mate, circleId)).toEqual([]);
    });
  });

  describe("Cat's cadence ruling — two days in a row, and never after", () => {
    test('spell day 3 closes the window for good', async () => {
      const { mate, circleId } = await emberFixture(3);

      expect(await windowsFor(circleId)).toEqual([]);
      expect(await coverableFor(mate, circleId)).toEqual([]);
    });

    test('a covered day 1 followed by a missed day 2 IS still day 2, and is asked', async () => {
      const missed = await createUser('Russ');
      const mate = await createUser('Cat');
      const circleId = await seedCircle(mate, [missed]);
      await selfDays(missed, circleId, 30, 3);
      await coverDay(mate, missed, circleId, 2);

      const found = await windowsFor(circleId);
      expect(found).toHaveLength(1);
      // Counted on SELF check-ins, so a covered day is still a day they
      // did not show up — which is what keeps two asks two. Without this
      // the covered day 1 would re-break the run on day 2 and re-open a
      // fresh window carrying a third ask.
      expect(found[0].spell_day).toBe(2);
    });

    test('a covered day 1 and a covered day 2 leave nothing to ask about on day 3', async () => {
      const missed = await createUser('Russ');
      const mate = await createUser('Cat');
      const circleId = await seedCircle(mate, [missed]);
      await selfDays(missed, circleId, 30, 4);
      await coverDay(mate, missed, circleId, 3);
      await coverDay(mate, missed, circleId, 2);

      expect(await windowsFor(circleId)).toEqual([]);
    });

    test('showing up yesterday in ANOTHER circle is not a spell at all', async () => {
      const missed = await createUser('Russ');
      const mate = await createUser('Cat');
      const circleId = await seedCircle(mate, [missed]);
      const otherCircleId = await seedCircle(missed);
      await selfDays(missed, circleId, 30, 2);
      // Yesterday done, but somewhere else — nothing here to rescue.
      await selfDays(missed, otherCircleId, 1, 1);

      expect(await windowsFor(circleId)).toEqual([]);
    });
  });

  describe('the covered notice (job 3)', () => {
    test('a cover landing enqueues exactly one warm notice, naming the coverer', async () => {
      const coverer = await createUser('Cat');
      const covered = await createUser('Russ');
      const circleId = await seedCircle(coverer, [covered]);

      await actAs(coverer);
      await client.query(
        `insert into public.completions (circle_id, user_id, local_date, kind, covered_by)
         values ($1, $2, (now() at time zone 'UTC')::date - 1, 'covered', $3)`,
        [circleId, covered, coverer]
      );

      const rows = await noticesFor(covered);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload.covererName).toBe('Cat');
      expect(rows[0].payload.covererId).toBe(coverer);
      expect(rows[0].payload.circleId).toBe(circleId);
      // Nothing renderable crosses the boundary — the sentence is composed
      // in send-notifications from a fixed template (S1 F4).
      expect(rows[0].payload.subject).toBeUndefined();
      expect(rows[0].payload.html).toBeUndefined();
    });

    test('the notice goes to the COVERED person, never the coverer', async () => {
      const coverer = await createUser('Cat');
      const covered = await createUser('Russ');
      const circleId = await seedCircle(coverer, [covered]);
      await coverDay(coverer, covered, circleId, 1);

      expect(await noticesFor(covered)).toHaveLength(1);
      expect(await noticesFor(coverer)).toHaveLength(0);
    });

    test('a block means no notice at all', async () => {
      const coverer = await createUser('Cat');
      const covered = await createUser('Russ');
      const circleId = await seedCircle(coverer, [covered]);
      await elevated();
      await client.query('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [
        covered,
        coverer,
      ]);
      await coverDay(coverer, covered, circleId, 1);

      expect(await noticesFor(covered)).toHaveLength(0);
    });

    test('a self check-in enqueues nothing', async () => {
      const user = await createUser('Russ');
      const circleId = await seedCircle(user);
      await selfDays(user, circleId, 1, 1);

      expect(await noticesFor(user)).toHaveLength(0);
    });
  });
});
