import fs from 'fs';
import path from 'path';

import { PairStreak } from './glow';
import {
  bestPairForCircle,
  crossedPairMilestone,
  PAIR_HEADLINE_MIN_DAYS,
  PAIR_MILESTONES,
  shouldShowPairRun,
} from './pairStreaks';

/**
 * PA4 — the friendship number (Personal-Arc memo §5.1, Glow-Spec §3/§5).
 *
 * The live cohort on 27 July is what these fixtures are shaped from:
 * every one of the eleven real pairs had a BROKEN run (nobody's last
 * shared day was today or yesterday), so the shipped consecutive-only
 * headline rendered fourteen zeros. The cumulative numbers derived from
 * that same data were 9, 8, 7, 6, 5, 5, 3, 3, 3, 2, 2 — which is the
 * state most of these tests reproduce.
 */
function pair(over: Partial<PairStreak> & { otherName: string }): PairStreak {
  return {
    otherUserId: `u-${over.otherName}`,
    streak: 0,
    daysTogether: 0,
    sharedThisCircle: true,
    ...over,
  };
}

describe('the cumulative headline', () => {
  it('shows a friendship whose live run has broken — the exact case that rendered zero', () => {
    const best = bestPairForCircle([pair({ otherName: 'Russ', daysTogether: 9, streak: 0 })]);
    expect(best?.daysTogether).toBe(9);
    expect(best?.streak).toBe(0);
  });

  it('ranks on the cumulative number, never on the fragile run', () => {
    const best = bestPairForCircle([
      pair({ otherName: 'Russ', daysTogether: 9, streak: 0 }),
      // A live 4-day run on a much younger friendship must not outrank a
      // 9-day history: letting the run choose would put a broken streak
      // in charge of which friendship is worth naming.
      pair({ otherName: 'Cathy S', daysTogether: 3, streak: 4 }),
    ]);
    expect(best?.otherName).toBe('Russ');
  });

  it('hides a friendship below the floor rather than showing a 1 or a 2', () => {
    expect(bestPairForCircle([pair({ otherName: 'Cathy S', daysTogether: 2, streak: 0 })])).toBeNull();
    expect(
      bestPairForCircle([pair({ otherName: 'Cathy S', daysTogether: PAIR_HEADLINE_MIN_DAYS })])
    ).not.toBeNull();
  });

  it('is stable across loads when two friendships tie', () => {
    const a = pair({ otherName: 'Alex Stewart', daysTogether: 5, streak: 0 });
    const b = pair({ otherName: 'Louise S', daysTogether: 5, streak: 0 });
    expect(bestPairForCircle([a, b])?.otherName).toBe('Alex Stewart');
    expect(bestPairForCircle([b, a])?.otherName).toBe('Alex Stewart');
  });

  it('breaks a tie toward the friendship that is actually running', () => {
    const best = bestPairForCircle([
      pair({ otherName: 'Alex Stewart', daysTogether: 5, streak: 0 }),
      pair({ otherName: 'Zoe', daysTogether: 5, streak: 3 }),
    ]);
    expect(best?.otherName).toBe('Zoe');
  });
});

describe('pair formation outlives the circle (Glow-Spec §3)', () => {
  it('keeps a friendship whose other half has LEFT the shared circle', () => {
    // The server forms pairs from shared history, so a departed member
    // still arrives with sharedThisCircle = true. Proven live: with
    // Catherine's membership row deleted, Russ still reads 7 with her,
    // while the pre-PA4 current-members rule dropped her entirely.
    const best = bestPairForCircle([
      pair({ otherName: 'Catherine', daysTogether: 7, streak: 0, sharedThisCircle: true }),
    ]);
    expect(best?.otherName).toBe('Catherine');
  });

  it('does not put a friendship from ANOTHER circle on this circle screen', () => {
    // The data is app-level on purpose; the DISPLAY is "best among the
    // members shown" (§3). A 9-day friendship formed somewhere else is
    // still not this huddle's line.
    expect(
      bestPairForCircle([pair({ otherName: 'Russ', daysTogether: 9, sharedThisCircle: false })])
    ).toBeNull();
  });
});

describe('the run is a flourish, never a zero', () => {
  it('is hidden when the run has broken', () => {
    expect(shouldShowPairRun(pair({ otherName: 'Russ', daysTogether: 9, streak: 0 }))).toBe(false);
  });

  it('is hidden at 1 — one day is not a run, it is just today', () => {
    expect(shouldShowPairRun(pair({ otherName: 'Russ', daysTogether: 9, streak: 1 }))).toBe(false);
  });

  it('appears from 2', () => {
    expect(shouldShowPairRun(pair({ otherName: 'Russ', daysTogether: 9, streak: 2 }))).toBe(true);
  });
});

describe('shared milestones ride the cumulative number', () => {
  it('is the 25/50/100 ladder the memo names', () => {
    expect([...PAIR_MILESTONES]).toEqual([25, 50, 100]);
  });

  it('fires on the crossing and never again', () => {
    expect(crossedPairMilestone(24, 25)).toBe(25);
    expect(crossedPairMilestone(25, 26)).toBeNull();
  });

  it('collapses a skipped backlog to one congratulation, the highest', () => {
    expect(crossedPairMilestone(20, 101)).toBe(100);
  });

  it('never fires backwards — the cumulative number cannot fall, so nothing re-crosses', () => {
    expect(crossedPairMilestone(60, 50)).toBeNull();
  });
});

describe('the forbidden shape (Glow-Spec §5: nobody sees a ranked list, ever)', () => {
  it('returns ONE friendship, never a list, however many exist', () => {
    const best = bestPairForCircle([
      pair({ otherName: 'Russ', daysTogether: 9 }),
      pair({ otherName: 'Catherine', daysTogether: 8 }),
      pair({ otherName: 'Alex Stewart', daysTogether: 5 }),
      pair({ otherName: 'Louise S', daysTogether: 4 }),
    ]);
    expect(Array.isArray(best)).toBe(false);
    expect(best?.otherName).toBe('Russ');
  });

  it('no screen renders pair streaks itself — they only ever reach PairStreakLine', () => {
    // A grep, deliberately: the law is about what reaches a SCREEN, and
    // a unit test of a pure helper cannot see a `.sort().slice(0, 3)`
    // added to a component later. Any screen holding pair streaks must
    // hand the whole list to PairStreakLine — which returns exactly one
    // — and must never iterate or rank them on its own.
    const screens = fs
      .readdirSync(path.join(__dirname, '..', 'app', '(app)', '(tabs)'))
      .filter((f) => f.endsWith('.tsx'));
    let checked = 0;
    for (const name of screens) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'app', '(app)', '(tabs)', name), 'utf8');
      if (!/pairStreaks/.test(src)) continue;
      checked++;
      expect(src).toContain('<PairStreakLine pairs={pairStreaks} />');
      expect(src).not.toMatch(/pairStreaks\s*\.\s*(sort|slice|map|filter|reduce)\s*\(/);
    }
    // The guard is worthless if it silently matched nothing.
    expect(checked).toBeGreaterThan(0);
  });
});
