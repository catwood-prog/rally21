import { NUDGE_RESTART_LINES, NUDGE_WARM_LINES, STRINGS } from '@/constants/strings';

import {
  DESIRED_CHANGE_KEYS,
  DesiredChange,
  domainForDesiredChange,
  isDesiredChange,
  isObstacle,
  OBSTACLE_KEYS,
} from './onboardingIntake';

describe('ON1 desired change (Q1)', () => {
  it('offers exactly the five PT1 domains plus connection', () => {
    expect(DESIRED_CHANGE_KEYS).toEqual(['move', 'mind', 'learn', 'make', 'care', 'connection']);
  });

  it('maps each of the five domains 1:1 to its practice-browse domain', () => {
    for (const d of ['move', 'mind', 'learn', 'make', 'care'] as DesiredChange[]) {
      expect(domainForDesiredChange(d)).toBe(d);
    }
  });

  it('connection is answered by the circle, not a practice domain → no domain filter', () => {
    expect(domainForDesiredChange('connection')).toBeNull();
  });

  it('validates stored values (and rejects out-of-set / null)', () => {
    expect(isDesiredChange('mind')).toBe(true);
    expect(isDesiredChange('connection')).toBe(true);
    expect(isDesiredChange('bogus')).toBe(false);
    expect(isDesiredChange(null)).toBe(false);
    expect(isDesiredChange(undefined)).toBe(false);
  });

  it('no orphan answer: every Q1 option has a label and a resolved destination', () => {
    for (const key of DESIRED_CHANGE_KEYS) {
      expect(STRINGS.onboardingDesiredChangeLabels[key]).toBeTruthy();
      // Either a real practice domain to filter, or connection→null (invite).
      const domain = domainForDesiredChange(key);
      expect(domain === null || ['move', 'mind', 'learn', 'make', 'care'].includes(domain)).toBe(true);
      // The Day-0 sentence can weave in every Q1 answer.
      expect(STRINGS.onboardingDayZeroDesiredPhrase[key]).toBeTruthy();
    }
  });
});

describe('ON1 keep-going obstacle (Q2)', () => {
  it('offers exactly the five fixed obstacles', () => {
    expect(OBSTACLE_KEYS).toEqual(['forget', 'no_time', 'lose_motivation', 'miss_once', 'alone']);
  });

  it('validates stored values (and rejects out-of-set / null = skip)', () => {
    expect(isObstacle('forget')).toBe(true);
    expect(isObstacle('miss_once')).toBe(true);
    expect(isObstacle('bogus')).toBe(false);
    expect(isObstacle(null)).toBe(false);
  });

  it('no orphan answer: every Q2 option has a label, a reflected phrase, and a real reassurance mechanic', () => {
    for (const key of OBSTACLE_KEYS) {
      expect(STRINGS.onboardingObstacleLabels[key]).toBeTruthy();
      expect(STRINGS.onboardingObstacleReflected[key]).toBeTruthy();
      expect(STRINGS.onboardingReassurance[key]).toBeTruthy();
    }
  });

  it('the miss-once reassurance names the embers + CV1 mechanic (the fear the warmth model answers)', () => {
    expect(STRINGS.onboardingReassurance.miss_once).toMatch(/cover you the next day/);
    expect(STRINGS.onboardingReassurance.miss_once).toMatch(/doesn't reset/);
  });

  it('the forget reassurance names the learned-timing nudge (NS1)', () => {
    expect(STRINGS.onboardingReassurance.forget).toMatch(/learns when you show up/);
  });
});

// ON2 job C — the lean's copy contract. The BEHAVIOUR (which line a given
// obstacle surfaces, and the neutral fallback) is pinned in
// notificationSpot.test.ts, where the decision actually lives; what is
// pinned here is that the lean never becomes a new copy surface.
describe('ON2 the lean chooses EXISTING copy, never new copy', () => {
  const NQ1_POOL: string[] = [...NUDGE_WARM_LINES, ...NUDGE_RESTART_LINES];

  it('every obstacle has a welcome line, and every line is drawn verbatim from the NQ1 pool', () => {
    for (const key of OBSTACLE_KEYS) {
      const line = STRINGS.todaySpotWelcomeLineByObstacle[key];
      expect(line).toBeTruthy();
      expect(NQ1_POOL).toContain(line);
    }
  });

  it('no two obstacles lean on the same line — a lean that does not differentiate is not a lean', () => {
    const lines = OBSTACLE_KEYS.map((k) => STRINGS.todaySpotWelcomeLineByObstacle[k]);
    expect(new Set(lines).size).toBe(OBSTACLE_KEYS.length);
  });

  it('the map holds nothing but the five obstacles (no stray keys to leak a line)', () => {
    expect(Object.keys(STRINGS.todaySpotWelcomeLineByObstacle).sort()).toEqual([...OBSTACLE_KEYS].sort());
  });

  // FF2 job D1 (Cat's ruling, 28 July). 'forget' was the one pairing that
  // could not point at a line answering its obstacle, because no line in
  // either pool named the nudge mechanic; the restart pool gained one. The
  // pin is that the line stays IN the restart half (restart-framed is the
  // right voice after a miss) and stays the one that names the mechanic —
  // reverting the pool line without repointing the lean fails here.
  it('forget leans on the restart line that names the nudge mechanic', () => {
    const line = STRINGS.todaySpotWelcomeLineByObstacle.forget;
    expect([...NUDGE_RESTART_LINES]).toContain(line);
    expect(line).toContain('nudge');
  });

  // The 'alone' borrow is BLESSED, not a compromise to be tidied away
  // (Cat, 28 July): the obstacle is answered only by the circle, which the
  // restart half never mentions, so the warm half is the right home.
  it('alone deliberately borrows the warm half — the restart half has no circle line', () => {
    expect([...NUDGE_WARM_LINES]).toContain(STRINGS.todaySpotWelcomeLineByObstacle.alone);
  });
});

describe('ON1 Day-0 reflected sentence', () => {
  it('is self-reported voice ("you said"), never the map\'s "we noticed"', () => {
    const s = STRINGS.onboardingDayZeroSentence('one miss usually ends it', "a missed day dims, it doesn't reset");
    expect(s.startsWith('you said')).toBe(true);
    expect(s).not.toMatch(/we noticed/i);
  });

  it('weaves both answers when Q1 is present', () => {
    const s = STRINGS.onboardingDayZeroWithDesired('a calmer mind', 'you forget', 'Rally nudges just before');
    expect(s).toMatch(/a calmer mind/);
    expect(s).toMatch(/you forget/);
    expect(s).toMatch(/Rally nudges just before/);
    expect(s).not.toMatch(/we noticed/i);
  });
});
