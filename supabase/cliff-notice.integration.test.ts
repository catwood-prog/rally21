/**
 * CV3 (23 Aug) — THE PERSON HEARS ONCE, ON CLIFF MORNING.
 *
 * CV2 shipped the friends' half of Cat's 16 Aug ruling. This suite pins
 * the person's half: `cliff_window_for(user)`, the one question "is
 * today this person's cliff morning?".
 *
 * WHY IT NEEDS A SUITE OF ITS OWN RATHER THAN A BRANCH IN
 * ember-ask.integration.test.ts. That suite pins a window that opens
 * BETWEEN people — its whole subject is who may be asked about whom.
 * This one opens INSIDE one person, and its reason for existing is
 * precisely the case that suite cannot express: a solo member, whom the
 * friend-ask structurally cannot reach. The solo test below is
 * therefore not an edge case here, it is the headline.
 *
 * FIXTURE LAW, INHERITED FROM CV2 AND STILL THE EASIEST WAY TO WRITE A
 * VACUOUS TEST. `cliffFixture(n)` produces spell EXACTLY n, and only
 * spell 5 produces a notice at all. So an exclusion test built at any
 * other spell passes whether or not the exclusion works — the spell
 * filter empties the result first. Every exclusion test below therefore
 * runs at SPELL 5, and a CONTROL at the top of that block fails loudly
 * if spell 5 ever stops being a spell that would otherwise fire.
 *
 * THE OFF-BY-ONE IS NOT RE-DERIVED HERE. 5 is ember_window_for's own
 * last-morning-a-cover-can-land, argued in that function's body. What
 * this suite asserts is that cliff_window_for agrees with it rather
 * than computing its own.
 *
 * See "Running the RPC-boundary integration tests" in CLAUDE.md for how
 * to supply SUPABASE_DB_URL — same direct-connection, single
 * rolled-back-transaction pattern as ember-ask.integration.test.ts.
 * Nothing here writes to public.questions, so the RE2 bank mutex does
 * not apply.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

if (!DB_URL) {
  console.warn(
    '[cliff-notice.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

type CliffWindow = { missed_local_date: string; spell_day: number };

describeIfConfigured('CV3 — the cliff window, for the person themselves', () => {
  let client: Client;
  let practiceId: string;

  async function elevated() {
    await client.query('reset role');
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
    const inviteCode = `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows } = await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by, is_public)
       values ('Cliff Test Circle', $1, $2, '08:00:00', $3, false)
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

  async function coverDay(covererId: string, coveredId: string, circleId: string, daysAgo: number) {
    await elevated();
    await client.query(
      `insert into public.completions (circle_id, user_id, local_date, kind, covered_by)
       values ($1, $2, (now() at time zone 'UTC')::date - $3::int, 'covered', $4)`,
      [circleId, coveredId, daysAgo, covererId]
    );
  }

  /**
   * Empties the nest on a given day, so the gap that starts there is
   * UNSHELTERED and the run really breaks. One gift per pair per day is
   * a unique index, so each unit of drain needs its own throwaway
   * recipient — eight is comfortably more than the cap of six.
   * (Lifted verbatim from ember-ask.integration.test.ts.)
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

  async function cliffWindow(userId: string): Promise<CliffWindow[]> {
    await elevated();
    const { rows } = await client.query(
      `select missed_local_date::text as missed_local_date, spell_day
         from public.cliff_window_for($1)`,
      [userId]
    );
    return rows;
  }

  async function emberWindow(userId: string, circleId: string) {
    await elevated();
    const { rows } = await client.query(
      `select missed_local_date::text as missed_local_date, spell_day
         from public.ember_window_for($1, $2)`,
      [userId, circleId]
    );
    return rows;
  }

  async function askedAbout(userId: string) {
    await elevated();
    const { rows } = await client.query(
      `select asked_user_id from public.find_open_ember_windows()
        where missed_user_id = $1`,
      [userId]
    );
    return rows;
  }

  /**
   * A 30-day run followed by `missedDays` consecutive missed days ending
   * at the DB's yesterday, with a circle-mate present. The nest is left
   * FULL, which since Cat's 9 Aug ruling is the ordinary case rather
   * than the excluded one — and it is also what makes these missed days
   * pebble-SHELTERED, which the notice requires (see the empty-nest
   * exclusion below).
   */
  async function cliffFixture(missedDays: number) {
    const person = await createUser('Russ');
    const mate = await createUser('Cat');
    const circleId = await seedCircle(mate, [person]);
    await selfDays(person, circleId, 30, missedDays + 1);
    return { person, mate, circleId };
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

  describe('the cliff morning', () => {
    test('spell 5 — the notice is owed, about yesterday', async () => {
      const { person } = await cliffFixture(5);

      const found = await cliffWindow(person);
      expect(found).toHaveLength(1);
      expect(found[0].spell_day).toBe(5);

      // The day it names is YESTERDAY, the missed day — never today.
      const { rows } = await client.query(
        `select ((now() at time zone 'UTC')::date - 1)::text as yesterday`
      );
      expect(found[0].missed_local_date).toBe(rows[0].yesterday);
    });

    test('MEASURED — glowing through spell 4, and already COLD on the spell-5 morning', async () => {
      // Written expecting 'glowing' on both mornings and CORRECTED by
      // the run: the cliff is not tomorrow from the engine's point of
      // view, it is ALREADY TODAY. glow_day_states counts today
      // inclusive, so on the spell-5 morning the gap is 6 days long
      // before the person has had any chance to act, and
      // get_glow_for_user reports state 'cold', glow 0,
      // ended_at_cliff true.
      //
      // This is why the notice exists and it is a sharper reason than
      // the brief had: the app does not merely fail to warn them, it
      // has already written the run off at midnight — silently, on a
      // morning when the run is still completely recoverable. See the
      // recoverability test directly below.
      const spell4 = await cliffFixture(4);
      const spell5 = await cliffFixture(5);
      await elevated();

      const four = await client.query(
        'select state, ended_at_cliff from public.get_glow_for_user($1)',
        [spell4.person]
      );
      expect(four.rows[0].state).toBe('glowing');

      const five = await client.query(
        'select state, glow, ended_at_cliff from public.get_glow_for_user($1)',
        [spell5.person]
      );
      expect(five.rows[0].state).toBe('cold');
      expect(five.rows[0].glow).toBe(0);
      expect(five.rows[0].ended_at_cliff).toBe(true);
    });

    test('MEASURED — and the run is still entirely recoverable that morning', async () => {
      // The other half of the sentence, and the reason the copy may say
      // today matters without overclaiming. 'cold' at 7am is not a
      // verdict: the glow is recomputed from scratch on every read, so
      // either rescue restores the whole run the same day.
      //
      // NOTE FOR THE COPY, and it is a real constraint: the run at
      // stake here is 26 / 25 days, but get_glow_for_user returns
      // glow = 0 on the cliff branch and never exposes the
      // run-before-the-break. No number is available to this pipeline
      // today, so no candidate line may quote one.
      const { person, mate, circleId } = await cliffFixture(5);
      await elevated();

      await client.query('savepoint before_rescue');
      await selfDays(person, circleId, 0, 0);
      const own = await client.query('select state, glow from public.get_glow_for_user($1)', [person]);
      expect(own.rows[0].state).toBe('glowing');
      expect(own.rows[0].glow).toBe(26);
      await client.query('rollback to savepoint before_rescue');

      await coverDay(mate, person, circleId, 1);
      const covered = await client.query('select state, glow from public.get_glow_for_user($1)', [person]);
      expect(covered.rows[0].state).toBe('glowing');
      expect(covered.rows[0].glow).toBe(25);
    });

    test('fires at spell 5 ONLY — swept across 0..6', async () => {
      // The bound in both directions in one assertion, so a future
      // widening has to come here and say so.
      const results: Record<number, number> = {};
      for (const spell of [0, 1, 2, 3, 4, 5, 6]) {
        const { person } = await cliffFixture(spell);
        results[spell] = (await cliffWindow(person)).length;
      }
      expect(results).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, 6: 0 });
    });

    test('one row per person, whatever the circle count', async () => {
      // The glow being rescued is personal, so two circles is one
      // notice — the same argument EM1 made for omitting the circle
      // from the ask's dedupe key, applied a level up.
      const person = await createUser('Russ');
      const mateA = await createUser('Cat');
      const mateB = await createUser('Abs');
      const circleA = await seedCircle(mateA, [person]);
      const circleB = await seedCircle(mateB, [person]);
      await selfDays(person, circleA, 30, 6);
      await selfDays(person, circleB, 30, 6);

      expect(await cliffWindow(person)).toHaveLength(1);
    });
  });

  describe('a solo member — the case the friend-ask cannot reach', () => {
    test('a circle of one still gets the notice', async () => {
      const person = await createUser('Russ');
      const circleId = await seedCircle(person); // no mates at all
      await selfDays(person, circleId, 30, 6);

      const found = await cliffWindow(person);
      expect(found).toHaveLength(1);
      expect(found[0].spell_day).toBe(5);
    });

    test('CONTROL — and nobody is asked about them, because there is nobody', async () => {
      // The measured gap Cat ruled on. If this ever starts returning
      // rows, the friend-ask has grown a way to reach a solo member and
      // the person's half should be re-argued, not silently doubled up.
      const person = await createUser('Russ');
      const circleId = await seedCircle(person);
      await selfDays(person, circleId, 30, 6);

      expect(await askedAbout(person)).toHaveLength(0);
    });
  });

  describe('the suppressions', () => {
    test('CONTROL — the bare spell-5 fixture really does fire', async () => {
      // Without this, every exclusion below would pass on a fixture that
      // was never going to produce a notice in the first place. CV2's
      // find: seven exclusion tests were hollow for exactly this reason.
      const { person } = await cliffFixture(5);
      expect(await cliffWindow(person)).toHaveLength(1);
    });

    test('a self check-in TODAY suppresses it', async () => {
      // The spell counts as of YESTERDAY, so this morning's check-in
      // does not move it — the suppression has to be its own guard, and
      // this is the test that proves the guard exists rather than being
      // assumed to fall out of the arithmetic.
      const { person, circleId } = await cliffFixture(5);
      expect(await cliffWindow(person)).toHaveLength(1);

      await selfDays(person, circleId, 0, 0);

      // The spell is UNMOVED — the proof that arithmetic alone would
      // still have fired.
      const stillOpen = await emberWindow(person, circleId);
      expect(stillOpen).toHaveLength(1);
      expect(stillOpen[0].spell_day).toBe(5);

      expect(await cliffWindow(person)).toHaveLength(0);
    });

    test('a cover landing on YESTERDAY suppresses it', async () => {
      const { person, mate, circleId } = await cliffFixture(5);
      expect(await cliffWindow(person)).toHaveLength(1);

      await coverDay(mate, person, circleId, 1);

      expect(await cliffWindow(person)).toHaveLength(0);
    });

    test('a cover in ONE circle of two suppresses it — the guard ember_window_for cannot make', async () => {
      // ember_window_for's own already-covered check is per-circle,
      // because a cover is written against a circle. The glow it
      // rescues is not. Without a personal guard, the uncovered circle
      // would still surface a window and this person would be told they
      // are about to fall off a cliff they were already carried over.
      const person = await createUser('Russ');
      const mateA = await createUser('Cat');
      const mateB = await createUser('Abs');
      const circleA = await seedCircle(mateA, [person]);
      const circleB = await seedCircle(mateB, [person]);
      await selfDays(person, circleA, 30, 6);
      await selfDays(person, circleB, 30, 6);
      expect(await cliffWindow(person)).toHaveLength(1);

      await coverDay(mateA, person, circleA, 1);

      // The OTHER circle's window is still wide open — this is the
      // trap, stated out loud rather than trusted.
      const uncovered = await emberWindow(person, circleB);
      expect(uncovered).toHaveLength(1);
      expect(uncovered[0].spell_day).toBe(5);

      expect(await cliffWindow(person)).toHaveLength(0);
    });

    test('an EMPTY NEST at spell 5 is not a cliff — nothing is being held, so nothing is claimed', async () => {
      // The find that produced the follow-up migration, kept as the
      // test that would catch its removal. With no pebble to spend, the
      // break was UNSHELTERED on the very first missed day: the run is
      // already gone by this morning and no cover can bring it back.
      //
      // The three sibling readers deliberately DISAGREE with this one
      // and that is correct, not a bug — a cover still does
      // re-engagement work for this person (CV2/EM1's reasoning), it
      // just rescues no number. Asserted here so the divergence is
      // documented rather than discovered.
      const person = await createUser('Russ');
      const mate = await createUser('Cat');
      const circleId = await seedCircle(mate, [person]);
      await selfDays(person, circleId, 30, 6);
      await drainNest(person, 5);

      await elevated();
      const glow = await client.query(
        'select state, glow, ended_at_cliff from public.get_glow_for_user($1)',
        [person]
      );
      expect(glow.rows[0].state).toBe('cold');
      expect(glow.rows[0].ended_at_cliff).toBe(false);

      // The window the screen reads is still open, and the friends are
      // still asked — unchanged by CV3.
      expect(await emberWindow(person, circleId)).toHaveLength(1);
      expect((await askedAbout(person)).length).toBeGreaterThan(0);

      // The person's own notice is NOT sent.
      expect(await cliffWindow(person)).toHaveLength(0);
    });

    test('and the reason it is withheld: a cover that morning would rescue nothing', async () => {
      // The measurement the exclusion rests on, so a future reader can
      // check the premise rather than trust the comment. Same fixture,
      // a cover lands on yesterday, and the glow does not move.
      const person = await createUser('Russ');
      const mate = await createUser('Cat');
      const circleId = await seedCircle(mate, [person]);
      await selfDays(person, circleId, 30, 6);
      await drainNest(person, 5);

      await coverDay(mate, person, circleId, 1);

      await elevated();
      const after = await client.query('select state, glow from public.get_glow_for_user($1)', [person]);
      expect(after.rows[0].state).toBe('cold');
      expect(after.rows[0].glow).toBe(0);
    });

    test('an away member is never told anything', async () => {
      // RS2 — away is a total pause. Inherited from ember_window_for
      // rather than re-implemented, and pinned so the inheritance is
      // not quietly lost.
      const { person } = await cliffFixture(5);
      expect(await cliffWindow(person)).toHaveLength(1);

      await elevated();
      await client.query('update public.users set away_since = now() where id = $1', [person]);

      expect(await cliffWindow(person)).toHaveLength(0);
    });

    test('a completed circle asks nothing of anyone', async () => {
      const { person, circleId } = await cliffFixture(5);
      expect(await cliffWindow(person)).toHaveLength(1);

      await elevated();
      await client.query('update public.circles set completed_at = now() where id = $1', [circleId]);

      expect(await cliffWindow(person)).toHaveLength(0);
    });

    test('never checked in at all — there is no rally to rescue', async () => {
      const person = await createUser('Russ');
      await seedCircle(person);

      expect(await cliffWindow(person)).toHaveLength(0);
    });
  });

  describe('the notice agrees with the screen', () => {
    test('SUBSET — every morning the notice fires, a cover would still be offered', async () => {
      // CV2's property, carried up a level. The person must never be
      // told "today is your last chance" on a morning the circle screen
      // has already stopped offering the rescue that would save them.
      // Swept, not asserted.
      for (const spell of [0, 1, 2, 3, 4, 5, 6]) {
        const { person, circleId } = await cliffFixture(spell);
        const notice = await cliffWindow(person);
        if (notice.length === 0) continue;
        const screen = await emberWindow(person, circleId);
        expect(screen).toHaveLength(1);
        expect(screen[0].missed_local_date).toBe(notice[0].missed_local_date);
      }
    });

    test("same morning as the friends' spell-5 ask — one day, two audiences", async () => {
      // Cat's ruling: the friends hear AND the person hears. Not on
      // different mornings.
      const { person } = await cliffFixture(5);

      const notice = await cliffWindow(person);
      const asks = await askedAbout(person);
      expect(notice).toHaveLength(1);
      expect(asks.length).toBeGreaterThan(0);

      await elevated();
      const { rows } = await client.query(
        `select distinct missed_local_date::text as d from public.find_open_ember_windows()
          where missed_user_id = $1`,
        [person]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].d).toBe(notice[0].missed_local_date);
    });
  });
});
