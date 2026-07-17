import { NUDGE_RESTART_LINES, NUDGE_WARM_LINES } from '../../../constants/strings';
import {
  LOVED_LINE_MIN_LIKES,
  LOVED_LINE_PREFIX,
  LikedQuote,
  NUDGE_PUSH_BODY_MAX_CHARS,
  NUDGE_SUBJECT,
  RESTART_LINES,
  RESTART_NO_REPEAT_COUNT,
  WARM_LINES,
  WARM_NO_REPEAT_DAYS,
  composeLovedNudge,
  isLovedLineDay,
  nudgeSentence,
  renderLovedLine,
  renderNudge,
  selectNudgeLine,
  shiftDate,
} from './nudge-lines';

// A run of consecutive dates starting from `start` (YYYY-MM-DD).
function consecutiveDates(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDate(start, i));
}

describe('pool identity (client ⇄ edge, hand-synced)', () => {
  it('the edge pools are byte-identical to constants/strings.ts', () => {
    // These two copies live in different module graphs (client TS vs the
    // Deno edge fn) and can only be kept in sync by hand — this test is the
    // guard that they never drift.
    expect(WARM_LINES).toEqual([...NUDGE_WARM_LINES]);
    expect(RESTART_LINES).toEqual([...NUDGE_RESTART_LINES]);
  });

  it('has the approved final counts (31 warm / 12 restart)', () => {
    expect(WARM_LINES).toHaveLength(31);
    expect(RESTART_LINES).toHaveLength(12);
    expect(new Set(WARM_LINES).size).toBe(31); // no accidental dupes
    expect(new Set(RESTART_LINES).size).toBe(12);
  });
});

describe('selectNudgeLine — branch', () => {
  it('picks a warm line when yesterday was completed', () => {
    const { branch, line } = selectNudgeLine({
      userId: 'u1',
      localDate: '2026-07-15',
      completedDates: ['2026-07-14'],
    });
    expect(branch).toBe('warm');
    expect(WARM_LINES).toContain(line);
  });

  it('picks a restart line when yesterday was missed', () => {
    const { branch, line } = selectNudgeLine({
      userId: 'u1',
      localDate: '2026-07-15',
      completedDates: ['2026-07-10'], // not yesterday
    });
    expect(branch).toBe('restart');
    expect(RESTART_LINES).toContain(line);
  });
});

describe('selectNudgeLine — determinism', () => {
  it('is stable for the same user + date + history', () => {
    const args = { userId: 'u1', localDate: '2026-07-15', completedDates: ['2026-07-14', '2026-07-13'] };
    expect(selectNudgeLine(args).line).toBe(selectNudgeLine(args).line);
  });

  it('differs by user (seeded per user)', () => {
    // Not a guarantee for any single pair, but across many users the same
    // date must not collapse to one line.
    const lines = new Set(
      Array.from({ length: 20 }, (_, i) =>
        selectNudgeLine({ userId: `user-${i}`, localDate: '2026-07-15', completedDates: ['2026-07-14'] }).line
      )
    );
    expect(lines.size).toBeGreaterThan(1);
  });
});

describe('no-repeat window — warm (10 days)', () => {
  it('never repeats a warm line within 10 days for the same user', () => {
    // All days completed → every day is a warm day (yesterday always done).
    const dates = consecutiveDates('2026-06-01', 20);
    const completed = new Set(consecutiveDates('2026-05-01', 90)); // covers all lookback
    const lines = dates.map(
      (d) => selectNudgeLine({ userId: 'u1', localDate: d, completedDates: completed }).line
    );
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j <= i + WARM_NO_REPEAT_DAYS && j < lines.length; j++) {
        expect(lines[j]).not.toBe(lines[i]);
      }
    }
  });
});

describe('no-repeat window — restart (last 6 restart days)', () => {
  it('never repeats a restart line within the last 6 restart days', () => {
    // No completions at all → every day is a restart day.
    const dates = consecutiveDates('2026-06-01', 20);
    const lines = dates.map(
      (d) => selectNudgeLine({ userId: 'u1', localDate: d, completedDates: [] }).line
    );
    for (const line of lines) expect(RESTART_LINES).toContain(line);
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j <= i + RESTART_NO_REPEAT_COUNT && j < lines.length; j++) {
        expect(lines[j]).not.toBe(lines[i]);
      }
    }
  });

  it('counts restart DAYS, not calendar days (warm days between misses do not reset the window)', () => {
    // Pattern: user misses every 3rd day. Restart days are the days after a
    // miss; they can be >6 calendar days apart yet still inside the last-6
    // restart-day window. Build a long alternating history and assert no two
    // of the 6 most recent restart days before `today` share a line.
    const userId = 'u1';
    const today = '2026-07-15';
    // Completed on all days EXCEPT every 3rd day going back — so ~1 in 3
    // days is a restart day.
    const completed = new Set<string>();
    for (let k = 1; k <= 60; k++) {
      const d = shiftDate(today, -k);
      if (k % 3 !== 0) completed.add(d); // miss every 3rd day back
    }
    // Reconstruct the restart days and their lines via the same function.
    const restartLinesSeen: string[] = [];
    for (let k = 60; k >= 0; k--) {
      const d = shiftDate(today, -k);
      const { branch, line } = selectNudgeLine({ userId, localDate: d, completedDates: completed });
      if (branch === 'restart') restartLinesSeen.push(line);
    }
    // Every window of 6 consecutive restart days must be collision-free.
    for (let i = 0; i < restartLinesSeen.length; i++) {
      for (let j = i + 1; j <= i + RESTART_NO_REPEAT_COUNT && j < restartLinesSeen.length; j++) {
        expect(restartLinesSeen[j]).not.toBe(restartLinesSeen[i]);
      }
    }
  });
});

describe("Cat's template (job 4)", () => {
  it('uses the fixed subject with no emoji', () => {
    expect(NUDGE_SUBJECT).toBe('A little nudge from Rally');
    expect(NUDGE_SUBJECT).toMatch(/^[\x00-\x7F]+$/); // ASCII only, no emoji
  });

  it('renders one / two / three+ practices without "with your circle"', () => {
    expect(nudgeSentence(['Meditate 10 minutes'])).toBe('one small thing to do today: meditate 10 minutes.');
    expect(nudgeSentence(['Meditate 10 minutes', 'Walk 20 minutes'])).toBe(
      'two small things to do today: meditate 10 minutes, walk 20 minutes.'
    );
    expect(nudgeSentence(['Read', 'Walk', 'Draw'])).toBe('a few small things to do today: read, walk, draw.');
    for (const s of [nudgeSentence(['A']), nudgeSentence(['A', 'B']), nudgeSentence(['A', 'B', 'C'])]) {
      expect(s).not.toMatch(/with your circle/i);
    }
  });

  it('builds the push body as sentence + line on its own line', () => {
    const { subject, pushBody, html } = renderNudge(['Walk 20 minutes'], 'keep up and you will be kept up.');
    expect(subject).toBe('A little nudge from Rally');
    expect(pushBody).toBe('one small thing to do today: walk 20 minutes.\nkeep up and you will be kept up.');
    expect(html).toContain('<p>one small thing to do today: walk 20 minutes.</p>');
    expect(html).toContain('<p>keep up and you will be kept up.</p>');
    expect(html).toContain('open Rally21');
    expect(html).not.toMatch(/with your circle/i);
    expect(html).not.toMatch(/<ul>/); // the old practice list is gone
  });
});

// --------------------------------------------------------------------------
// NQ2 — "a line you loved"

const shortQuote = (key: string, over: Partial<LikedQuote> = {}): LikedQuote => ({
  cardKey: key,
  body: 'Forever is composed of nows.',
  attribution: 'Emily Dickinson',
  tier: 'classic_public_domain',
  ...over,
});

/** First loved-line day for a user on/after `from` — the cadence is seeded
 * per user, so tests derive their dates from the same function the composer
 * uses instead of hard-coding one user's lucky day. */
function firstLovedDay(userId: string, from = '2026-07-01'): string {
  let d = from;
  for (let i = 0; i < 60; i++) {
    if (isLovedLineDay(userId, d)) return d;
    d = shiftDate(d, 1);
  }
  throw new Error(`no loved-line day within 60 days for ${userId}`);
}

function firstPlainDay(userId: string, from = '2026-07-01'): string {
  let d = from;
  for (let i = 0; i < 60; i++) {
    if (!isLovedLineDay(userId, d)) return d;
    d = shiftDate(d, 1);
  }
  throw new Error(`no plain day within 60 days for ${userId}`);
}

describe('NQ2 — loved-line cadence (isLovedLineDay)', () => {
  it('never fires on two consecutive days, for any user', () => {
    for (const userId of ['u1', 'u2', 'cadence-user-3', '75ec0d88-27de-4227-ab62-3d049b369960']) {
      let d = '2026-01-01';
      let prev = false;
      for (let i = 0; i < 400; i++) {
        const today = isLovedLineDay(userId, d);
        expect(prev && today).toBe(false);
        prev = today;
        d = shiftDate(d, 1);
      }
    }
  });

  it('lands roughly weekly (about 12% of days across a year)', () => {
    for (const userId of ['u1', 'u2', 'cadence-user-3']) {
      let d = '2026-01-01';
      let count = 0;
      for (let i = 0; i < 365; i++) {
        if (isLovedLineDay(userId, d)) count++;
        d = shiftDate(d, 1);
      }
      // Expected ≈ 365 · (1/7) · (6/7) ≈ 45. A wide band — this pins the
      // order of magnitude ("roughly weekly"), not the exact draw.
      expect(count).toBeGreaterThanOrEqual(20);
      expect(count).toBeLessThanOrEqual(75);
    }
  });

  it('is deterministic — same user + date always agrees', () => {
    const day = firstLovedDay('u1');
    expect(isLovedLineDay('u1', day)).toBe(true);
    expect(isLovedLineDay('u1', day)).toBe(true);
  });
});

describe('NQ2 — the gate (LOVED_LINE_MIN_LIKES)', () => {
  const base = (userId: string, likedQuotes: LikedQuote[]) => ({
    userId,
    localDate: firstLovedDay(userId),
    branch: 'warm' as const,
    likedQuotes,
    practiceNames: ['Walk 20 minutes'],
  });

  it('0 or 2 likes → never a loved line, even on a loved-line day', () => {
    expect(composeLovedNudge(base('u1', []))).toBeNull();
    expect(composeLovedNudge(base('u1', [shortQuote('QB-001'), shortQuote('QB-002')]))).toBeNull();
  });

  it('3+ likes → a loved line on a loved-line day, plain pool on other days', () => {
    const quotes = [shortQuote('QB-001'), shortQuote('QB-002'), shortQuote('QB-003')];
    expect(quotes.length).toBeGreaterThanOrEqual(LOVED_LINE_MIN_LIKES);
    const loved = composeLovedNudge(base('u1', quotes));
    expect(loved).not.toBeNull();
    expect(loved!.line.startsWith(LOVED_LINE_PREFIX)).toBe(true);
    expect(
      composeLovedNudge({ ...base('u1', quotes), localDate: firstPlainDay('u1') })
    ).toBeNull();
  });

  it('duplicate likes of the same card count once toward the floor', () => {
    const dupes = [shortQuote('QB-001'), shortQuote('QB-001'), shortQuote('QB-001')];
    expect(composeLovedNudge(base('u1', dupes))).toBeNull();
  });

  it('a restart day never serves a loved line (the slot is the warm-line slot)', () => {
    const quotes = [shortQuote('QB-001'), shortQuote('QB-002'), shortQuote('QB-003')];
    expect(composeLovedNudge({ ...base('u1', quotes), branch: 'restart' })).toBeNull();
  });
});

describe('NQ2 — determinism of the pick', () => {
  it('spreads picks across the whole like-set over many loved days (no gate/pick hash correlation)', () => {
    // Regression guard: the pick seed shares its userId-date suffix with the
    // day-gate seed, and the raw 31-hashes of the two are affinely related —
    // a plain seededIndex pick measured ~330/40/35/310 over a 4-quote pool.
    // The avalanche-mixed pick must reach every quote a healthy number of
    // times across a long span.
    const quotes = [shortQuote('QB-001'), shortQuote('QB-002'), shortQuote('QB-003'), shortQuote('QB-004')];
    const counts = new Map<string, number>();
    let d = '2024-01-01';
    let lovedDays = 0;
    for (let i = 0; i < 2000; i++) {
      const loved = composeLovedNudge({
        userId: 'u1',
        localDate: d,
        branch: 'warm',
        likedQuotes: quotes,
        practiceNames: ['Walk 20 minutes'],
      });
      if (loved) {
        lovedDays++;
        counts.set(loved.cardKey, (counts.get(loved.cardKey) ?? 0) + 1);
      }
      d = shiftDate(d, 1);
    }
    expect(counts.size).toBe(4); // every liked quote serves eventually
    for (const [, n] of counts) expect(n).toBeGreaterThan(lovedDays / 10); // no starved corner
  });

  it('same user + date + like-set always picks the same quote', () => {
    const quotes = [shortQuote('QB-001'), shortQuote('QB-002'), shortQuote('QB-003'), shortQuote('QB-004')];
    const args = {
      userId: 'u1',
      localDate: firstLovedDay('u1'),
      branch: 'warm' as const,
      likedQuotes: quotes,
      practiceNames: ['Walk 20 minutes'],
    };
    const a = composeLovedNudge(args);
    const b = composeLovedNudge({ ...args, likedQuotes: [...quotes].reverse() }); // order-independent
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    expect(quotes.map((q) => q.cardKey)).toContain(a!.cardKey);
  });
});

describe('NQ2 — the length skip (NUDGE_PUSH_BODY_MAX_CHARS)', () => {
  it('when no liked quote fits the push body → plain pool that day, never truncated', () => {
    const longBody = 'x'.repeat(NUDGE_PUSH_BODY_MAX_CHARS + 1);
    const allLong = [
      shortQuote('QB-001', { body: longBody }),
      shortQuote('QB-002', { body: longBody }),
      shortQuote('QB-003', { body: longBody }),
    ];
    expect(
      composeLovedNudge({
        userId: 'u1',
        localDate: firstLovedDay('u1'),
        branch: 'warm',
        likedQuotes: allLong,
        practiceNames: ['Walk 20 minutes'],
      })
    ).toBeNull();
  });

  it('a too-long quote is skipped for push, not truncated — a fitting like still serves', () => {
    const longBody = 'x'.repeat(NUDGE_PUSH_BODY_MAX_CHARS + 1);
    const mixed = [
      shortQuote('QB-001', { body: longBody }),
      shortQuote('QB-002', { body: longBody }),
      shortQuote('QB-003'), // the only one that fits
    ];
    const loved = composeLovedNudge({
      userId: 'u1',
      localDate: firstLovedDay('u1'),
      branch: 'warm',
      likedQuotes: mixed,
      practiceNames: ['Walk 20 minutes'],
    });
    expect(loved).not.toBeNull();
    expect(loved!.cardKey).toBe('QB-003');
    expect(loved!.line).not.toContain('xxx');
  });

  it('a served loved line always fits the whole push body inside the cutoff', () => {
    const quotes = [shortQuote('QB-001'), shortQuote('QB-002'), shortQuote('QB-003')];
    let d = '2026-01-01';
    for (let i = 0; i < 120; i++) {
      const loved = composeLovedNudge({
        userId: 'u1',
        localDate: d,
        branch: 'warm',
        likedQuotes: quotes,
        practiceNames: ['Walk 20 minutes'],
      });
      if (loved) {
        expect(renderNudge(['Walk 20 minutes'], loved.line).pushBody.length).toBeLessThanOrEqual(
          NUDGE_PUSH_BODY_MAX_CHARS
        );
      }
      d = shiftDate(d, 1);
    }
  });
});

describe('NQ2 — attribution', () => {
  it('an MV (modern_voice_in_copyright) quote always renders its author line', () => {
    const mv = shortQuote('MV-01', {
      body: 'The days are long, but the years are short.',
      attribution: 'Gretchen Rubin',
      tier: 'modern_voice_in_copyright',
    });
    expect(renderLovedLine(mv)).toBe(
      `${LOVED_LINE_PREFIX}“The days are long, but the years are short.” — Gretchen Rubin`
    );
    const loved = composeLovedNudge({
      userId: 'u1',
      localDate: firstLovedDay('u1'),
      branch: 'warm',
      likedQuotes: [mv, mv, mv].map((q, i) => ({ ...q, cardKey: `MV-0${i + 1}` })),
      practiceNames: ['Walk 20 minutes'],
    });
    expect(loved).not.toBeNull();
    expect(loved!.line).toContain(' — Gretchen Rubin');
  });

  it('an MV row without a renderable author is excluded from eligibility outright', () => {
    const badMv = shortQuote('MV-09', { attribution: null, tier: 'modern_voice_in_copyright' });
    // 2 good + 1 attribution-less MV = below the floor once it's excluded.
    expect(
      composeLovedNudge({
        userId: 'u1',
        localDate: firstLovedDay('u1'),
        branch: 'warm',
        likedQuotes: [shortQuote('QB-001'), shortQuote('QB-002'), badMv],
        practiceNames: ['Walk 20 minutes'],
      })
    ).toBeNull();
  });

  it("a PD 'Unknown'/null attribution renders no author line but stays eligible (same rule as the cards)", () => {
    expect(renderLovedLine(shortQuote('QB-042', { body: 'Create more space.', attribution: 'Unknown' }))).toBe(
      `${LOVED_LINE_PREFIX}“Create more space.”`
    );
    expect(renderLovedLine(shortQuote('AN-01', { body: 'A quiet win counts.', attribution: null }))).toBe(
      `${LOVED_LINE_PREFIX}“A quiet win counts.”`
    );
    const loved = composeLovedNudge({
      userId: 'u1',
      localDate: firstLovedDay('u1'),
      branch: 'warm',
      likedQuotes: [
        shortQuote('QB-042', { attribution: 'Unknown' }),
        shortQuote('AN-01', { attribution: null, tier: 'original_unattributed' }),
        shortQuote('QB-001'),
      ],
      practiceNames: ['Walk 20 minutes'],
    });
    expect(loved).not.toBeNull();
  });
});
