import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';

import { PairStreak } from '@/lib/glow';

import { PairStreakLine } from './PairStreakLine';

/**
 * PA4 VERIFY 2 — the rendered headlines, against LIVE DATA.
 *
 * Every fixture below is a verbatim row returned by the real
 * get_pair_streaks() RPC on 2026-07-27/28, called as the named user
 * against the named circle, and independently cross-checked against a
 * derivation written separately from the function (pairs formed by an
 * ever-shared circle; the cumulative number = the size of the
 * intersection of the two members' glow_qualifying_days series).
 *
 * THE STATE THIS FIXES: every one of the eleven live pairs had a broken
 * run — the whole cohort's most recent shared day was 24 July — so the
 * shipped consecutive-only headline rendered a zero for all of them.
 * That is the "screen of zeros beside your friends' names" memo §5
 * exists to remove, and the assertions here are what prove it removed:
 * the rendered sentences carry 9, 8, 7, 6, 5 and 3, and no rendered
 * string anywhere contains a zero.
 */

function row(
  otherName: string,
  streak: number,
  daysTogether: number,
  sharedThisCircle = true
): PairStreak {
  return { otherUserId: `u-${otherName}`, otherName, streak, daysTogether, sharedThisCircle };
}

function renderText(pairs: PairStreak[]): string[] {
  let renderer: ReturnType<typeof create> | null = null;
  act(() => {
    renderer = create(React.createElement(PairStreakLine, { pairs }));
  });
  const out = renderer!.root
    .findAllByType(Text)
    .flatMap((node) => node.props.children)
    .filter((c): c is string => typeof c === 'string');
  act(() => {
    renderer!.unmount();
  });
  return out;
}

// Exactly as returned by get_pair_streaks(<circle>) for each caller.
const LIVE = {
  // Russ -> Stretching/Yoga moves (da4766c3…)
  russ: [row('Catherine S', 0, 9), row('Catherine', 0, 7), row('Cathy S', 0, 6)],
  // Catherine S -> Daily Meditation (da18799e…). Note what this row set
  // proves on its own: her 9 with Russ and her 5 with Louise S arrive
  // here at all — the data really is app-level now — and arrive with
  // sharedThisCircle = false, so this circle's screen does not claim
  // them. Order is verbatim, i.e. NOT sorted by the number.
  catherineS: [
    row('Russ', 0, 9, false),
    row('Catherine', 0, 8),
    row('Louise S', 0, 5, false),
    row('Alex Stewart', 0, 5),
    row('Cathy S', 0, 3, false),
  ],
  // Louise S -> Breath of Fire … morning boost (2ae9d518…)
  louise: [row('Catherine S', 0, 5), row('Cathy S', 0, 3)],
};

describe('the rendered friendship headline, on live cohort numbers', () => {
  it("renders Russ's best friendship as its cumulative 9, not the run's 0", () => {
    expect(renderText(LIVE.russ)).toEqual(['you and Catherine S: 9 days together']);
  });

  it("renders Catherine S's best THIS-CIRCLE friendship as 8 — her 9 with Russ belongs to another circle's screen", () => {
    expect(renderText(LIVE.catherineS)).toEqual(['you and Catherine: 8 days together']);
  });

  it("renders Louise S's best friendship as 5", () => {
    expect(renderText(LIVE.louise)).toEqual(['you and Catherine S: 5 days together']);
  });

  it('renders NO zero anywhere, for any live caller — the defect this section exists to fix', () => {
    for (const pairs of Object.values(LIVE)) {
      for (const line of renderText(pairs)) {
        expect(line).not.toMatch(/\b0\b/);
      }
    }
  });

  it('draws no flourish while every live run is broken — a zero run is absent, never rendered as "0 in a row"', () => {
    // All three callers' runs were 0 on the day this was measured.
    for (const pairs of Object.values(LIVE)) {
      expect(renderText(pairs).some((l) => l.includes('in a row'))).toBe(false);
    }
  });
});

describe('the live run, once there is one', () => {
  it('appears beside the headline without replacing it', () => {
    expect(renderText([row('Russ', 4, 9)])).toEqual([
      'you and Russ: 9 days together',
      '4 in a row 🔥',
    ]);
  });

  it('breaking the run leaves the headline untouched — the friendship keeps its worth', () => {
    const withRun = renderText([row('Russ', 4, 9)]);
    const runBroken = renderText([row('Russ', 0, 9)]);
    expect(withRun[0]).toBe('you and Russ: 9 days together');
    expect(runBroken[0]).toBe('you and Russ: 9 days together');
    expect(runBroken).toHaveLength(1);
  });
});

describe('the line stays absent rather than showing something thin', () => {
  it('renders nothing when there are no friendships yet', () => {
    expect(renderText([])).toEqual([]);
  });

  it('renders nothing below the floor', () => {
    expect(renderText([row('Russ', 0, 2)])).toEqual([]);
  });

  it('renders nothing when every friendship belongs to another circle', () => {
    expect(renderText([row('Russ', 0, 9, false)])).toEqual([]);
  });
});

describe('one friendship reaches the screen, never a ranked list (Glow-Spec §5)', () => {
  it('renders a single headline however many friendships exist', () => {
    const lines = renderText([
      row('Catherine S', 0, 9),
      row('Catherine', 0, 8),
      row('Alex Stewart', 0, 5),
      row('Louise S', 0, 4),
      row('Cathy S', 0, 3),
    ]);
    expect(lines.filter((l) => l.startsWith('you and'))).toHaveLength(1);
    expect(lines.join(' ')).not.toContain('Louise S');
  });
});
