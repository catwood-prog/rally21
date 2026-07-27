import * as fs from 'fs';
import * as path from 'path';

import { STRINGS } from '@/constants/strings';

import * as journey from './journey';

/**
 * PA2 — the ceremony becomes personal.
 *
 * These are SOURCE-LEVEL invariants as much as unit tests, and that is
 * deliberate: PA2's guarantees are mostly about what must NOT exist any
 * more. A unit test can prove a function behaves; only a grep can prove a
 * whole path was deleted, and "no path can set a circle-wide rally
 * decision" is exactly the kind of claim that rots the moment someone
 * re-adds a helper in good faith.
 */

const APP_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIRS = ['app', 'lib', 'components', 'constants'];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const d of SOURCE_DIRS) walk(path.join(APP_ROOT, d));
  return out;
}

/**
 * Comments are stripped before matching, and that is not a detail: these
 * invariants are about what the CODE does, and this file's own subject
 * matter means the deleted symbols get NAMED in the comments explaining
 * why they were deleted. A grep that counted those would fail forever
 * and teach the next person to delete the guardrail instead of the
 * defect. (The `(?<!:)` guard keeps `https://` out of it.)
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '');
}

const FILES = sourceFiles().map((f) => {
  const raw = fs.readFileSync(f, 'utf8');
  return { path: path.relative(APP_ROOT, f), text: stripComments(raw) };
});

describe('JOB 1 — no path can set a circle-wide rally decision', () => {
  it('exports no rallyOnCircle helper', () => {
    expect('rallyOnCircle' in journey).toBe(false);
  });

  it('no source file calls the rally_on_circle RPC or a rallyOnCircle helper', () => {
    const offenders = FILES.filter(
      (f) => f.text.includes('rally_on_circle') || f.text.includes('rallyOnCircle')
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('nothing branches on the circle-level rallied flag any more', () => {
    // The column survives as history and for two server-side readers
    // (see migration 20260727234000), but no screen may DECIDE on it —
    // that was the first-mover race's whole surface area.
    const offenders = FILES.filter(
      (f) => f.text.includes('ralliedOnAt') && f.path !== 'lib/circle.ts'
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('the waiting-on-host state is gone with the decision it described', () => {
    expect('journeyGateWaitingOnHost' in STRINGS).toBe(false);
  });
});

describe('JOB 2 — the ceremony is not spent by being looked at', () => {
  const gate = FILES.find((f) => f.path === 'app/(app)/journey-gate.tsx')!;

  it('journey-gate marks the celebration seen exactly once, from the answer path', () => {
    const calls = gate.text.match(/markCelebrationSeen\(/g) ?? [];
    // One import reference plus one call site. More than one CALL means a
    // second path is writing the marker, which is how the mount bug got
    // in the first time.
    expect(calls).toHaveLength(1);
  });

  it('the marker write is not inside the load effect', () => {
    // The load effect ends at its dependency array; the answer handler is
    // defined further down. If markCelebrationSeen appears before the
    // effect closes, it has crept back onto mount.
    const effectEnd = gate.text.indexOf('}, [circleId, router, session?.user?.id]);');
    expect(effectEnd).toBeGreaterThan(-1);
    const loadEffect = gate.text.slice(0, effectEnd);
    expect(loadEffect).not.toContain('markCelebrationSeen(');
  });

  it('the fait-accompli branch is gone: no decision can arrive already made', () => {
    // journey-gate.tsx:67 used to read `if (c.ralliedOnAt)
    // setDecision('rallied')` on LOAD — the single line that handed a
    // later arrival somebody else's answer as a finished fact. The
    // invariant is broader than deleting that line: the load path must
    // not set the decision AT ALL, because any server value that could
    // pre-set it is by definition a decision this person did not make.
    const effectEnd = gate.text.indexOf('}, [circleId, router, session?.user?.id]);');
    expect(effectEnd).toBeGreaterThan(-1);
    expect(gate.text.slice(0, effectEnd)).not.toContain('setDecision(');
  });
});

describe('JOB 3 — finishing is personal, and reversible', () => {
  it('exposes finish and resume, and they are the only writers of finished_at', () => {
    expect(typeof journey.finishMyRally).toBe('function');
    expect(typeof journey.resumeMyRally).toBe('function');
    const writers = FILES.filter((f) => f.text.includes('finish_my_rally') || f.text.includes('resume_my_rally')).map(
      (f) => f.path
    );
    expect(writers).toEqual(['lib/journey.ts']);
  });

  it('finishing a rally never touches the circle', () => {
    // The bug this forbids: wiring "finish here" to completeCircle, which
    // would let any member archive a circle for everyone.
    const gate = FILES.find((f) => f.path === 'app/(app)/journey-gate.tsx')!;
    expect(gate.text).not.toContain('completeCircle');
  });

  it('the finished-state copy never claims the circle ended', () => {
    // Cat's ruled 3k body said "what you built together is archived, not
    // lost" — true when finishing meant the creator archiving a circle,
    // false now that the circle carries on without you.
    const finished = [
      STRINGS.journeyFinishedBody,
      STRINGS.journeyFinishConfirmBody,
      STRINGS.journeyFinishedCardTitle,
    ].join(' ');
    expect(finished).not.toMatch(/archiv/i);
    expect(finished.toLowerCase()).toContain('circle');
  });
});

describe('memo §5 — no leaderboard survives this section', () => {
  it('the huddle marks a finished member with a word, never a standing count', () => {
    // A per-member number rendered permanently in the huddle is a ranked
    // list by another name, which §5 forbids outright.
    expect(STRINGS.journeyFinishedMemberBadge).not.toMatch(/\d/);
    expect(STRINGS.journeyFinishedMemberBadge).toBe('rally complete');
  });

  it('no source file sorts members by a practice or rally count', () => {
    const offenders = FILES.filter((f) =>
      /sort\([^)]*(rallyCount|practiceCount|completions?\.length)/.test(f.text)
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('JOB 4 — no stale-zero survives on a celebrated-day read', () => {
  it('today.tsx never defaults a celebrated-day marker to 0', () => {
    const today = FILES.find((f) => f.path === 'app/(app)/(tabs)/today.tsx')!;
    expect(today.text).not.toMatch(/lastCelebratedDay\s*(\?\?|\|\|)\s*0/);
    // and the unknown case is skipped rather than guessed
    expect(today.text).toContain('data.lastCelebratedDay === null');
  });

  it('circle.tsx still refuses to decide on an unloaded marker (CB1, unregressed)', () => {
    const circle = FILES.find((f) => f.path === 'app/(app)/(tabs)/circle.tsx')!;
    expect(circle.text).toContain('myLastCelebratedDay === null');
  });
});
