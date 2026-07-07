import {
  assembleAskRallySystemPrompt,
  buildBlueprintBlock,
  buildCircleBlock,
  buildReflectionsBlock,
  buildStatesBlock,
  buildWantsNote,
  countMessagesOnLocalDate,
  describeConfidence,
  describeCoverage,
  describeGlowState,
  describeMoodTrend,
  describePattern,
} from './context';
import { SYSTEM_PROMPT_TEMPLATE } from './system-prompt';

describe('describeConfidence', () => {
  it('matches lib/blueprint.ts\'s bands exactly (kept in sync by hand)', () => {
    expect(describeConfidence(0.39)).toBeNull();
    expect(describeConfidence(0.4)).toBe('hunch');
    expect(describeConfidence(0.6)).toBe('fairly sure');
    expect(describeConfidence(0.8)).toBe('solid');
  });
});

describe('describePattern', () => {
  it('renders a synthesis pattern as its own statement', () => {
    expect(
      describePattern({
        patternType: 'synthesis_pattern',
        weekday: null,
        direction: null,
        cutoffHour: null,
        agreementCount: 0,
        totalCount: 0,
        statement: 'When grateful, it is almost always about people.',
      })
    ).toBe('When grateful, it is almost always about people.');
  });

  it('renders a deterministic weekday pattern with its evidence count', () => {
    const text = describePattern({
      patternType: 'weekday_mood',
      weekday: 4,
      direction: 'low',
      cutoffHour: null,
      agreementCount: 5,
      totalCount: 7,
      statement: null,
    });
    expect(text).toContain('Thursday');
    expect(text).toContain('5 of their last 7');
  });
});

describe('describeCoverage', () => {
  it('names the best- and worst-covered dimensions', () => {
    const line = describeCoverage({ energy: 0.1, values: 0.4, habits: 0.9, mood: 0.9, relationships: 0.2 });
    expect(line).toContain('habits');
    expect(line).toContain('energy');
  });

  it('returns null for an empty coverage map', () => {
    expect(describeCoverage({})).toBeNull();
  });
});

describe('buildBlueprintBlock', () => {
  it('says so honestly when there is nothing yet, rather than an empty block', () => {
    const block = buildBlueprintBlock({ traits: [], patterns: [], coverage: {} });
    expect(block.toLowerCase()).toContain('no blueprint patterns yet');
  });

  it('includes traits and patterns when present', () => {
    const block = buildBlueprintBlock({
      traits: [{ key: 't1', label: 'Consistency-driven', confidence: 0.65 }],
      patterns: [
        {
          patternType: 'synthesis_pattern',
          weekday: null,
          direction: null,
          cutoffHour: null,
          agreementCount: 0,
          totalCount: 0,
          statement: 'Grateful lines are almost always about people.',
        },
      ],
      coverage: { mood: 0.9, energy: 0.1 },
    });
    expect(block).toContain('fairly sure');
    expect(block).toContain('Consistency-driven');
    expect(block).toContain('Grateful lines are almost always about people.');
  });
});

describe('describeMoodTrend', () => {
  it('reports climbing when the recent half is clearly higher', () => {
    expect(describeMoodTrend([2, 2, 2, 4, 5, 5])).toBe('mood climbing');
  });

  it('reports dipping when the recent half is clearly lower', () => {
    expect(describeMoodTrend([5, 5, 5, 3, 2, 2])).toBe('mood dipping');
  });

  it('reports a steady average otherwise', () => {
    expect(describeMoodTrend([4, 4, 4, 4])).toBe('mood steady around 4');
  });

  it('returns null with no data at all — never fabricates a reading', () => {
    expect(describeMoodTrend([])).toBeNull();
  });
});

describe('describeGlowState', () => {
  it('never fabricates an energy number and only speaks to real glow state', () => {
    expect(describeGlowState({ glow: 12, state: 'glowing', emberDeadline: null })).toContain('12 days');
    expect(describeGlowState({ glow: 3, state: 'embers', emberDeadline: '2026-07-08' })).toContain('embers');
    expect(describeGlowState({ glow: 0, state: 'cold', emberDeadline: null })).toBeNull();
    expect(describeGlowState(null)).toBeNull();
  });
});

describe('buildReflectionsBlock / buildCircleBlock', () => {
  it('renders reflection lines verbatim, dated', () => {
    const block = buildReflectionsBlock([{ localDate: '2026-07-05', line1: 'my mom', line2: 'patience' }]);
    expect(block).toContain('2026-07-05');
    expect(block).toContain('"my mom"');
    expect(block).toContain('"patience"');
  });

  it('names circles without leaking anything about other members beyond headcount', () => {
    const block = buildCircleBlock([
      { practiceName: 'Meditate 10 minutes', dayNumber: 12, circleName: 'The Regulars', checkedIn: 3, memberCount: 4 },
    ]);
    expect(block).toContain('day 12');
    expect(block).toContain('3 of 4');
    expect(block).not.toMatch(/@/); // no email-shaped string could ever appear
  });
});

describe('buildWantsNote', () => {
  it('is empty when there is no confirmed want', () => {
    expect(buildWantsNote({ wantStatement: null, hasActivation: false })).toBe('');
  });

  it('is empty once the want already became a practice', () => {
    expect(buildWantsNote({ wantStatement: 'You keep reaching for quiet mornings.', hasActivation: true })).toBe('');
  });

  it('mentions the act flow gently, without pushing, when confirmed and not yet acted on', () => {
    const note = buildWantsNote({ wantStatement: 'You keep reaching for quiet mornings.', hasActivation: false });
    expect(note).toContain('quiet mornings');
    expect(note).toContain('never push it');
  });
});

describe('countMessagesOnLocalDate — the daily rate limit', () => {
  it('counts only messages on the caller\'s own local date', () => {
    const now = new Date('2026-07-07T12:00:00.000Z');
    const timestamps = [
      '2026-07-07T09:00:00.000Z', // today
      '2026-07-07T11:00:00.000Z', // today
      '2026-07-06T23:30:00.000Z', // yesterday UTC
    ];
    expect(countMessagesOnLocalDate(timestamps, 'UTC', now)).toBe(2);
  });

  it('resolves the local date per timezone, not UTC', () => {
    // 2026-07-07T02:00:00Z is still 2026-07-06 evening in America/Los_Angeles
    const now = new Date('2026-07-07T02:00:00.000Z');
    const timestamps = ['2026-07-07T01:00:00.000Z'];
    expect(countMessagesOnLocalDate(timestamps, 'America/Los_Angeles', now)).toBe(1);
    expect(countMessagesOnLocalDate(timestamps, 'UTC', now)).toBe(1);
    // a message from the following UTC day that's still "today" in LA
    const laTimestamps = ['2026-07-07T06:00:00.000Z']; // 2026-07-06 23:00 LA time... same local day as `now`
    expect(countMessagesOnLocalDate(laTimestamps, 'America/Los_Angeles', now)).toBe(1);
  });
});

describe('assembleAskRallySystemPrompt', () => {
  it('fills in every template block, none left unreplaced, and appends the wants note', () => {
    const prompt = assembleAskRallySystemPrompt({
      template: SYSTEM_PROMPT_TEMPLATE,
      crisisResources: 'UK — 116 123. US — 988.',
      blueprintBlock: 'No blueprint patterns yet.',
      statesBlock: 'No recent check-in history yet.',
      reflectionsBlock: 'No reflections yet.',
      circleBlock: 'Not currently in any active circle.',
      wantsNote: '\n\nWANTS\nThis person has a confirmed want.',
    });
    expect(prompt).not.toContain('{{');
    expect(prompt).toContain('WHO YOU ARE');
    expect(prompt).toContain('988');
    expect(prompt).toContain('WANTS');
  });

  it('appends nothing when there is no want to mention', () => {
    const prompt = assembleAskRallySystemPrompt({
      template: SYSTEM_PROMPT_TEMPLATE,
      crisisResources: 'UK — 116 123. US — 988.',
      blueprintBlock: 'x',
      statesBlock: 'x',
      reflectionsBlock: 'x',
      circleBlock: 'x',
      wantsNote: '',
    });
    expect(prompt).not.toContain('WANTS');
  });
});
