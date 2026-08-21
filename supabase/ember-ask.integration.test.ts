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
 * ══════════════════════════════════════════════════════════════════
 * CV2 (18 Aug) — ELIGIBILITY AND POLICY ARE NOW TWO THINGS
 * ══════════════════════════════════════════════════════════════════
 *
 * EM1 had both readers share one BOUND. CV2 keeps one DEFINITION but
 * splits the bound in two, because they were answering different
 * questions all along:
 *
 *   ember_window_for        — "can a cover still help here?" spells 1..5,
 *                             the full shelter window. What the circle
 *                             screen's 🧡 pill reads.
 *   find_open_ember_windows — "should we ASK someone?" spells 2 and 5
 *                             only, Cat's ruling of 15 Aug. A filter over
 *                             the rows above, never a re-derivation.
 *
 * THE PROPERTY THAT REPLACES "IDENTICAL BOUNDS" IS A SUBSET RELATION:
 * every (member, day) the ask fires on is a (member, day) the screen
 * offers a cover for, so the notification can still never offer a rescue
 * the circle screen would refuse. That was always EM1's real guarantee;
 * equal bounds were only how it was achieved. It is PROVEN below by
 * sweeping spells 0..6 and comparing the two readers, not asserted.
 *
 * FIXTURE LAW, AND IT IS THE EASIEST WAY TO WRITE A VACUOUS TEST HERE:
 * `emberFixture(n)` produces spell EXACTLY n, and spells 1, 3 and 4 now
 * produce NO ASK on their own. So an exclusion test built on
 * emberFixture(1) — as all seven of them were before CV2 — passes whether
 * or not the exclusion works, because the spell filter empties the list
 * first. Every exclusion test below therefore runs at SPELL 2, and a
 * control at the top of that block fails loudly if that ever stops being
 * a spell that would otherwise produce an ask.
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
    test('spell 2 — the third morning: the circle-mate is asked, about yesterday', async () => {
      // CV2: Cat's original sentence, "miss two days in a row, then on
      // the third day get a message". v_spell counts fully missed days as
      // of YESTERDAY, so her sentence is spell 2 and the ask lands on the
      // gap's third morning.
      const { missed, mate, circleId } = await emberFixture(2);

      const found = await windowsFor(circleId);
      expect(found).toHaveLength(1);
      expect(found[0].asked_user_id).toBe(mate);
      expect(found[0].missed_user_id).toBe(missed);
      expect(found[0].missed_user_name).toBe('Russ');
      expect(found[0].spell_day).toBe(2);

      const { rows: dates } = await client.query(
        `select ((now() at time zone 'UTC')::date - 1)::text as yesterday`
      );
      // CV1's window slides: the coverable day is always the member's own
      // local yesterday, so the ask targets the most recent missed day,
      // never the first one (which is out of reach for good).
      expect(found[0].missed_local_date).toBe(dates[0].yesterday);
    });

    test('spell 5 — the last morning a cover can hold their place: asked again', async () => {
      // The second of Cat's two moments. 5 is the last spell value at
      // which a cover still resets glow_day_states' gap counter — it
      // shelters while v_gap_len <= 5 and cliffs at 6, and v_gap_len is
      // one HIGHER than v_spell for the same real gap.
      const { missed, mate, circleId } = await emberFixture(5);

      const found = await windowsFor(circleId);
      expect(found).toHaveLength(1);
      expect(found[0].asked_user_id).toBe(mate);
      expect(found[0].missed_user_id).toBe(missed);
      expect(found[0].spell_day).toBe(5);

      const { rows: dates } = await client.query(
        `select ((now() at time zone 'UTC')::date - 1)::text as yesterday`
      );
      expect(found[0].missed_local_date).toBe(dates[0].yesterday);
    });

    test('spell 1 — the second morning: NOT asked, but the pill still offers', async () => {
      // THE ASK AND THE PILL DELIBERATELY DISAGREE HERE, and this is the
      // whole shape of CV2. A cover on this morning works, so the screen
      // offers it; nobody is poked about it, because Cat ruled the first
      // ask waits for the third morning. Under EM1 this was an ask.
      const { missed, mate, circleId } = await emberFixture(1);

      expect(await windowsFor(circleId)).toEqual([]);

      const coverable = await coverableFor(mate, circleId);
      expect(coverable).toHaveLength(1);
      expect(coverable[0].user_id).toBe(missed);
    });

    test('every other member of the circle is asked, once each', async () => {
      const missed = await createUser('Russ');
      const mateA = await createUser('Cat');
      const mateB = await createUser('Sam');
      const circleId = await seedCircle(mateA, [missed, mateB]);
      // CV2: spell 2, so the ask actually fires. At the old spell-1
      // fixture this test would now assert an empty list against an
      // empty list and prove nothing.
      await selfDays(missed, circleId, 30, 3);

      const found = await windowsFor(circleId);
      expect(found.map((w) => w.asked_user_id).sort()).toEqual([mateA, mateB].sort());
      // Never about themselves.
      expect(found.some((w) => w.asked_user_id === missed)).toBe(false);
    });
  });

  describe('ONE definition — the ask is a strict SUBSET of what the pill offers', () => {
    /**
     * CV2's replacement for "identical bounds", swept rather than
     * asserted. For every spell 0..6 this builds an independent circle,
     * asks BOTH readers, and checks the implication that actually
     * matters: an ask implies a coverable member. The converse is
     * deliberately allowed to fail — spells 1, 3 and 4 offer a cover with
     * no ask, which is the point of the split.
     */
    test('sweeping spells 0..6: every ask has a cover behind it, and 2+5 are the asks', async () => {
      const asked: number[] = [];
      const offered: number[] = [];

      for (let spell = 0; spell <= 6; spell++) {
        const missed = await createUser(`Russ ${spell}`);
        const mate = await createUser(`Cat ${spell}`);
        const circleId = await seedCircle(mate, [missed]);
        // spell 0 means they checked in yesterday: no gap at all.
        await selfDays(missed, circleId, 30, spell === 0 ? 1 : spell + 1);

        const windowsHere = await windowsFor(circleId);
        const coverableHere = await coverableFor(mate, circleId);

        if (windowsHere.length > 0) {
          asked.push(spell);
          // THE INVARIANT: the notification can never offer a rescue the
          // circle screen would refuse.
          expect(coverableHere).toHaveLength(1);
          expect(coverableHere[0].user_id).toBe(missed);
          expect(coverableHere[0].missed_local_date).toBe(windowsHere[0].missed_local_date);
          expect(windowsHere[0].spell_day).toBe(spell);
        }
        if (coverableHere.length > 0) offered.push(spell);
      }

      // Cat's ruling, and the shelter window it sits inside.
      expect(asked).toEqual([2, 5]);
      expect(offered).toEqual([1, 2, 3, 4, 5]);
      // Stated as the relation itself, so a future widening of either
      // side has to keep it true rather than just keep the two lists.
      expect(asked.every((s) => offered.includes(s))).toBe(true);
    });

    test('a full nest is now irrelevant: the window is open and the pill is shown', async () => {
      const { missed, mate, circleId } = await emberFixture(2);

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
      const { missed, mate, circleId } = await emberFixture(2);
      await drainNest(missed, 2);

      expect(await glowState(missed)).toBe('embers');

      const found = await windowsFor(circleId);
      expect(found).toHaveLength(1);
      const coverable = await coverableFor(mate, circleId);
      expect(coverable.map((r) => r.user_id)).toEqual([missed]);
    });

    test('every exclusion the finder makes, the pill makes too', async () => {
      const { missed, mate, circleId } = await emberFixture(2);
      await coverDay(mate, missed, circleId, 1);

      expect(await windowsFor(circleId)).toEqual([]);
      expect(await coverableFor(mate, circleId)).toEqual([]);
    });

    test('a non-member asking gets nothing, never an error that confirms the circle', async () => {
      const { circleId } = await emberFixture(2);
      const outsider = await createUser('Outsider');

      expect(await coverableFor(outsider, circleId)).toEqual([]);
    });
  });

  describe('the exclusions — each one a promise about not poking people', () => {
    // CV2 — EVERY TEST IN THIS BLOCK RUNS AT SPELL 2, ON PURPOSE. They
    // were all written on emberFixture(1) under EM1, where spell 1 was an
    // asking day. It no longer is, so on the old fixture each of these
    // would assert an empty list that the SPELL FILTER had already
    // emptied — seven promises about not poking people, all passing, none
    // of them tested. This control is the tripwire for that: if spell 2
    // ever stops producing an ask, it fails here rather than silently
    // hollowing out the seven tests below.
    test('CONTROL: the un-excluded spell-2 fixture really does produce an ask', async () => {
      const { circleId } = await emberFixture(2);
      expect(await windowsFor(circleId)).toHaveLength(1);
    });

    test('already covered for the missed day: no ask', async () => {
      const { missed, mate, circleId } = await emberFixture(2);
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
      const { missed, circleId } = await emberFixture(2);
      await elevated();
      await client.query('update public.users set away_since = now() where id = $1', [missed]);
      expect(await windowsFor(circleId)).toEqual([]);
    });

    test('an away circle-mate is never asked TO cover', async () => {
      const { mate, circleId } = await emberFixture(2);
      await elevated();
      await client.query('update public.users set away_since = now() where id = $1', [mate]);
      expect(await windowsFor(circleId)).toEqual([]);
    });

    test('a finished circle asks nobody anything', async () => {
      const { circleId } = await emberFixture(2);
      await elevated();
      await client.query('update public.circles set completed_at = now() where id = $1', [circleId]);
      expect(await windowsFor(circleId)).toEqual([]);
    });

    test('an inactive circle asks nobody anything', async () => {
      const { circleId } = await emberFixture(2);
      await elevated();
      await client.query('update public.circles set is_active = false where id = $1', [circleId]);
      expect(await windowsFor(circleId)).toEqual([]);
    });

    test('a block stops the ask in BOTH directions (MOD1)', async () => {
      const forward = await emberFixture(2);
      await elevated();
      await client.query(
        'insert into public.blocks (blocker_id, blocked_id) values ($1, $2)',
        [forward.mate, forward.missed]
      );
      expect(await windowsFor(forward.circleId)).toEqual([]);

      const reverse = await emberFixture(2);
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

  describe("Cat's cadence ruling — two moments, spell 2 and spell 5", () => {
    /**
     * CV2 — THE INVERTED EXPECTATION. Under EM1 this test read "spell day
     * 3 closes the window for good" and asserted that BOTH readers went
     * silent. Half of it is now false: the ASK is still silent at spell 3
     * (it is not one of Cat's two moments), but the PILL is not, because
     * a cover on that morning still resets the gap. The old second
     * assertion — `coverableFor` empty — is exactly what this section
     * exists to reverse, so it is inverted rather than deleted.
     */
    test('spell 3 — the ask stays silent, but the window is NO LONGER closed for good', async () => {
      const { missed, mate, circleId } = await emberFixture(3);

      expect(await windowsFor(circleId)).toEqual([]);

      const coverable = await coverableFor(mate, circleId);
      expect(coverable).toHaveLength(1);
      expect(coverable[0].user_id).toBe(missed);
    });

    test('spell 4 — same: no ask, and a cover that still works', async () => {
      const { mate, circleId } = await emberFixture(4);

      expect(await windowsFor(circleId)).toEqual([]);
      expect(await coverableFor(mate, circleId)).toHaveLength(1);
    });

    test('spell 6 — past the cliff: both readers close, and this is the real edge', async () => {
      // glow_day_states shelters while v_gap_len <= 5 and cliffs at 6.
      // v_gap_len is one HIGHER than v_spell for the same gap, so spell 6
      // is the first morning a cover can no longer hold the run — and the
      // first morning the pill correctly disappears.
      const { mate, circleId } = await emberFixture(6);

      expect(await windowsFor(circleId)).toEqual([]);
      expect(await coverableFor(mate, circleId)).toEqual([]);
    });

    test('the two asking moments are NOT adjacent, so no ask ever repeats next morning', async () => {
      // 3-3 was rejected partly for consecutive-day repeats. Cat's 2+5
      // makes them structurally impossible: between the two asking spells
      // sit 3 and 4, both silent.
      const silent = await Promise.all(
        [3, 4].map(async (spell) => {
          const { circleId } = await emberFixture(spell);
          return (await windowsFor(circleId)).length;
        })
      );
      expect(silent).toEqual([0, 0]);
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

    test('two covered days do not reset the spell: this is spell 3, so no ask', async () => {
      const missed = await createUser('Russ');
      const mate = await createUser('Cat');
      const circleId = await seedCircle(mate, [missed]);
      await selfDays(missed, circleId, 30, 4);
      await coverDay(mate, missed, circleId, 3);
      await coverDay(mate, missed, circleId, 2);

      // The spell is counted on SELF check-ins only, so two covers later
      // this is still spell 3 — not an asking moment.
      expect(await windowsFor(circleId)).toEqual([]);
      // CV2: but the pill DOES still offer, and a cover here would still
      // reset the gap. Under EM1 both were silent.
      expect(await coverableFor(mate, circleId)).toHaveLength(1);
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
