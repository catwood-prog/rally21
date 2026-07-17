import { NUDGE_RESTART_LINES, NUDGE_WARM_LINES } from '../../../constants/strings';
import {
  NUDGE_SUBJECT,
  RESTART_LINES,
  RESTART_NO_REPEAT_COUNT,
  WARM_LINES,
  WARM_NO_REPEAT_DAYS,
  nudgeSentence,
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
