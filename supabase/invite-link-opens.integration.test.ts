/**
 * IL2 (8 Aug) — the pre-auth invite-open counter, now proven DORMANT at the
 * real boundary rather than open at it.
 *
 * IL1 job 3 wrote this suite to prove the project's first anon EXECUTE grant
 * worked. Cat declined that grant on 7 August — not because the function was
 * unsafe, but because an allowlist turns HD1's machine-checkable "0
 * anon-executable" into a standing human judgement — so the first assertion
 * inverts: anon must now be REFUSED at 42501, which is a more valuable test
 * than the one it replaces. A revoked grant with no test is a grant that can
 * come back by accident in the next migration that touches this function.
 *
 * THE FUNCTION AND ITS TABLE ARE DELIBERATELY KEPT, executable by no client
 * role, because that is the shape a future TRUSTED-CONTEXT caller needs (the
 * sanctioned one being a public edge function holding the service-role key,
 * never a client grant). So every test below that describes the FUNCTION'S
 * OWN BEHAVIOUR still earns its place and is kept — it now runs from a
 * trusted connection instead of as anon, which is exactly how that future
 * caller would reach it. What is gone is only the coverage that existed to
 * describe the grant itself.
 *
 * Same direct-connection, rollback-only pattern as the other RPC-boundary
 * suites — see "Running the RPC-boundary integration tests" in CLAUDE.md
 * for how to supply SUPABASE_DB_URL.
 */
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfConfigured = DB_URL ? describe : describe.skip;

// Kept in step with the migration's c_daily_open_cap / the CHECK.
const DAILY_OPEN_CAP = 200;

if (!DB_URL) {
  // (No eslint-disable for no-console here: the rule does not fire in this
  // directory, and the sibling suites' directives are all reported as
  // unused warnings. One fewer than the file next door, deliberately.)
  console.warn(
    '[invite-link-opens.integration.test] SUPABASE_DB_URL not set — skipping. ' +
      'See "Running the RPC-boundary integration tests" in CLAUDE.md.'
  );
}

describeIfConfigured('record_invite_link_open (dormant since IL2)', () => {
  let client: Client;
  let practiceId: string;
  // RE1's lesson, 6 Aug: a fixture that draws a fresh random value per run
  // is a hidden seed. Codes here are counter-based and deterministic. They
  // also cannot collide with a real circle's code by construction —
  // create_circle's alphabet excludes I, L, O, 0 and 1, and every code
  // below contains at least two of them.
  let codeCounter = 0;
  function nextCode(): string {
    codeCounter += 1;
    return `IL${String(codeCounter).padStart(4, '0')}`;
  }

  async function elevated() {
    await client.query('reset role');
  }

  async function actAs(role: 'anon' | 'authenticated') {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.sub', '', true)");
  }

  async function expectRejection(sql: string, params: unknown[], match: RegExp) {
    await client.query('savepoint expected_failure');
    await expect(client.query(sql, params)).rejects.toThrow(match);
    // Roll back BEFORE resetting the role: a failed statement aborts the
    // transaction, and `reset role` is itself rejected until the savepoint
    // is unwound (25P02 — the same shape RE1's M2 mis-read as a network
    // fault). The rollback also restores the role the SET LOCAL replaced.
    await client.query('rollback to savepoint expected_failure');
  }

  async function seedCircleWithCode(code: string): Promise<void> {
    await elevated();
    const id = crypto.randomUUID();
    await client.query('insert into auth.users (id) values ($1)', [id]);
    await client.query(
      `insert into public.circles (name, practice_id, invite_code, time_of_day, created_by)
       values ('IL1 fixture circle', $1, $2, '08:00:00', $3)`,
      [practiceId, code, id]
    );
  }

  async function opensFor(code: string): Promise<number | null> {
    await elevated();
    const { rows } = await client.query<{ opens: number }>(
      'select opens from analytics.invite_link_opens where invite_code = $1 and open_date = current_date',
      [code]
    );
    return rows.length === 0 ? null : Number(rows[0].opens);
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

  describe('the grant Cat declined', () => {
    test('a signed-out caller is REFUSED — the anon grant is gone', async () => {
      const code = nextCode();
      await seedCircleWithCode(code);

      await actAs('anon');
      // 42501 insufficient_privilege, which is what every other public
      // function in this project does to anon and what this one did again
      // from IL2's migration onward. This assertion is the reversal of
      // IL1's; if it ever goes green the other way, an anon grant has come
      // back and HD1's sweep is no longer answering a boolean.
      await expectRejection(
        'select public.record_invite_link_open($1)',
        [code],
        /permission denied for function record_invite_link_open/i
      );
      await elevated();

      // And the refusal is total: nothing was written on the way to it.
      expect(await opensFor(code)).toBeNull();
    });

    test('a signed-in caller is refused too — no CLIENT role can execute it', async () => {
      const code = nextCode();
      await seedCircleWithCode(code);

      // The kept state is HD4's variant D, {postgres=X, service_role=X}:
      // both server-side roles, service_role's key never shipped in the
      // bundle. "Dormant" has to mean no client role at all, or the
      // authenticated faucet HD4 closed is quietly open again on this one
      // function.
      await actAs('authenticated');
      await expectRejection(
        'select public.record_invite_link_open($1)',
        [code],
        /permission denied for function record_invite_link_open/i
      );
      await elevated();

      expect(await opensFor(code)).toBeNull();
    });

    test('anon cannot read the tally either — the schema is granted to no role', async () => {
      // `analytics` is not PostgREST-exposed and its ACL names no client
      // role (AN1). Unchanged by IL2 and still worth asserting: the table
      // survives this revert, so the reason it is safe to keep must too.
      await actAs('anon');
      await expectRejection(
        'select * from analytics.invite_link_opens',
        [],
        /permission denied for schema analytics/i
      );
      await elevated();
    });
  });

  describe('the function itself, from a trusted context', () => {
    // These are the properties a future edge-function caller would depend
    // on. They were true when anon called it and they are true now; only
    // the connection asking has changed.

    test('opens accumulate for a real code', async () => {
      const code = nextCode();
      await seedCircleWithCode(code);

      await client.query('select public.record_invite_link_open($1)', [code]);
      await client.query('select public.record_invite_link_open($1)', [code]);
      await client.query('select public.record_invite_link_open($1)', [code]);

      expect(await opensFor(code)).toBe(3);
    });

    test('the code is matched case-insensitively, as join_circle_by_code matches it', async () => {
      const code = nextCode();
      await seedCircleWithCode(code);

      await client.query('select public.record_invite_link_open($1)', [code.toLowerCase()]);
      await client.query('select public.record_invite_link_open($1)', [` ${code} `]);

      expect(await opensFor(code)).toBe(2);
    });

    test('a well-shaped code matching no circle writes NOTHING — this is what bounds the table', async () => {
      const unknown = nextCode();
      // deliberately NOT seeded
      await elevated();
      await client.query('select public.record_invite_link_open($1)', [unknown]);

      // A caller sweeping the six-character space cannot grow this table by
      // one row, which is the difference between a counter and a dump.
      expect(await opensFor(unknown)).toBeNull();
    });

    test('real and unknown codes return the identical nothing', async () => {
      const real = nextCode();
      await seedCircleWithCode(real);
      const unknown = nextCode();

      const hit = await client.query('select public.record_invite_link_open($1) as r', [real]);
      const miss = await client.query('select public.record_invite_link_open($1) as r', [unknown]);

      // void renders as '' — same shape, same value, no row count, no error.
      // This mattered as an anti-oracle property while anon could call it;
      // it is kept because it is the reason the function can be handed to a
      // pre-auth caller again without redesigning it.
      expect(hit.rows).toEqual(miss.rows);
      expect(hit.rows[0].r).toBe('');
    });

    test('malformed input is ignored silently, never an error a caller would see', async () => {
      await elevated();
      for (const bad of ['', '   ', 'ABC', 'ABCDEFG', 'ABC-12', "'; drop table circles; --", null]) {
        await expect(
          client.query('select public.record_invite_link_open($1)', [bad])
        ).resolves.toBeDefined();
      }
    });

    test('the per-day cap makes further opens a genuine no-op, not a runaway update', async () => {
      const code = nextCode();
      await seedCircleWithCode(code);

      await client.query(
        `insert into analytics.invite_link_opens (invite_code, open_date, opens)
         values ($1, current_date, $2)`,
        [code, DAILY_OPEN_CAP]
      );

      await client.query('select public.record_invite_link_open($1)', [code]);
      await client.query('select public.record_invite_link_open($1)', [code]);

      // Not merely "clamped to the cap" — the WHERE means no row version is
      // written at all, so hammering it costs nothing to lock. If a future
      // edit drops the WHERE, the CHECK constraint turns this into a loud
      // failure rather than a silent one.
      expect(await opensFor(code)).toBe(DAILY_OPEN_CAP);
    });

    test('the table cannot hold user text — AN1 no-text law, held by CHECK', async () => {
      await elevated();
      // A future migration adding a free-text column would still have to get
      // past this: the only text column there is refuses anything that is not
      // exactly the generator's shape.
      await expectRejection(
        `insert into analytics.invite_link_opens (invite_code, open_date, opens)
         values ($1, current_date, 1)`,
        ['a note someone typed'],
        /invite_link_opens_code_shape/i
      );
    });
  });
});
