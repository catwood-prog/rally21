import { saveReflection } from './checkin';
import { getLocalDateString } from './date';
import {
  GOALS_SET_CYCLE,
  getGoalsSetQuestion,
  goalsSetIndexForDates,
  goalsSetLabelForKey,
} from './goalsSet';
import { supabase } from './supabase';

// ── the cycle itself: Cat's final wording, verbatim (spec table) ────────

describe('GOALS_SET_CYCLE', () => {
  it('is the spec table, verbatim and in order', () => {
    expect(GOALS_SET_CYCLE).toEqual([
      { key: 'goal', question: "what's a goal that matters to you right now?", placeholder: 'big or small' },
      {
        key: 'step',
        question: "what's one small step you could take tomorrow towards your goals?",
        placeholder: 'tiny counts',
      },
      {
        key: 'space',
        question: 'what would make a little space to step toward your goals this week?',
        placeholder: 'one small opening',
      },
      {
        key: 'attention',
        question: 'where would you like to put more attention?',
        placeholder: 'one area is plenty',
      },
      {
        key: 'meaning to',
        question: "what have you been meaning to do, that hasn't happened yet?",
        placeholder: 'no judgement, just naming it',
      },
      { key: 'win', question: "what's one small win from today?", placeholder: 'anything that went right' },
      { key: 'learnt', question: 'one thing you have learnt recently', placeholder: 'anything you noticed' },
      {
        key: 'progress',
        question: 'where have you quietly made progress lately?',
        placeholder: 'small still counts',
      },
      {
        key: 'imagine',
        question: 'how will it feel when you reach your goals?',
        placeholder: 'picture it for a moment',
      },
      {
        key: 'honest',
        question: "what's been getting in your way lately?",
        placeholder: 'say it plainly, no blame',
      },
    ]);
  });

  it('stays lowercase (voice ruling) with no scolding punctuation', () => {
    for (const q of GOALS_SET_CYCLE) {
      expect(q.question).toBe(q.question.toLowerCase());
      expect(q.placeholder).toBe(q.placeholder.toLowerCase());
      expect(q.question).not.toMatch(/!/);
    }
  });
});

// ── selection: deterministic, tz-local, mod-10 ──────────────────────────

describe('goalsSetIndexForDates', () => {
  it('starts the cycle on the account-creation day and marches in order', () => {
    expect(goalsSetIndexForDates('2026-07-01', '2026-07-01')).toBe(0); // goal
    expect(goalsSetIndexForDates('2026-07-01', '2026-07-02')).toBe(1); // step
    expect(goalsSetIndexForDates('2026-07-01', '2026-07-04')).toBe(3); // attention
    expect(goalsSetIndexForDates('2026-07-01', '2026-07-10')).toBe(9); // honest
  });

  it('wraps mod 10 — day 10 is goal again, day 25 is win', () => {
    expect(goalsSetIndexForDates('2026-07-01', '2026-07-11')).toBe(0);
    expect(goalsSetIndexForDates('2026-07-01', '2026-07-26')).toBe(5);
  });

  it('a missed day is simply skipped — the order marches on the calendar', () => {
    // If 2026-07-05 (index 4) was never checked in, 2026-07-06 still
    // lands on index 5 — the cycle follows the calendar, never a counter.
    expect(goalsSetIndexForDates('2026-07-01', '2026-07-06')).toBe(5);
  });

  it('crosses month and year boundaries without drifting', () => {
    expect(goalsSetIndexForDates('2026-07-28', '2026-08-01')).toBe(4);
    expect(goalsSetIndexForDates('2025-12-30', '2026-01-03')).toBe(4);
  });

  it('never indexes negatively when the clock reads before creation', () => {
    expect(goalsSetIndexForDates('2026-07-10', '2026-07-08')).toBe(8);
    expect(goalsSetIndexForDates('2026-07-10', '2026-07-10')).toBe(0);
  });
});

describe('getGoalsSetQuestion', () => {
  it('is same-day stable — repeated calls return the identical question', () => {
    const a = getGoalsSetQuestion('2026-07-01T09:15:00Z', '2026-07-08');
    const b = getGoalsSetQuestion('2026-07-01T09:15:00Z', '2026-07-08');
    expect(a).toBe(b); // same object from the cycle table, not a copy
  });

  it('depends only on the creation INSTANT, not its string representation', () => {
    // The same moment written in UTC and in +01:00 must land on the same
    // local date and therefore the same question, whatever the device tz.
    const utc = getGoalsSetQuestion('2026-07-01T23:30:00Z', '2026-07-15');
    const offset = getGoalsSetQuestion('2026-07-02T00:30:00+01:00', '2026-07-15');
    expect(utc).toBe(offset);
  });

  it('interprets the creation timestamp in the device timezone (the same rule as every local date in the app)', () => {
    const createdAt = '2026-07-01T23:30:00Z';
    const expectedLocal = getLocalDateString(new Date(createdAt));
    expect(getGoalsSetQuestion(createdAt, '2026-07-15')).toBe(
      GOALS_SET_CYCLE[goalsSetIndexForDates(expectedLocal, '2026-07-15')]
    );
  });
});

// ── journal label map ───────────────────────────────────────────────────

describe('goalsSetLabelForKey', () => {
  it('labels every cycle key as itself', () => {
    for (const q of GOALS_SET_CYCLE) {
      expect(goalsSetLabelForKey(q.key)).toBe(q.key);
    }
  });

  it('falls back to "learned" for null (pre-GQ1 rows) and unknown keys', () => {
    expect(goalsSetLabelForKey(null)).toBe('learned');
    expect(goalsSetLabelForKey('banana')).toBe('learned');
  });
});

// ── skip-key logging at the save boundary ───────────────────────────────

describe('saveReflection line2_prompt_key', () => {
  it('writes the key even when line2 is blank — the empty answer IS the skip log', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    (supabase.from as jest.Mock).mockReturnValue({ upsert });

    await saveReflection({
      userId: 'u1',
      localDate: '2026-07-21',
      mood: 4,
      line1: 'the morning light',
      line2: null,
      line2PromptKey: 'honest',
      questionId: null,
      questionAnswer: null,
      questionSkipped: false,
    });

    expect(supabase.from).toHaveBeenCalledWith('reflections');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ line2: null, line2_prompt_key: 'honest' }),
      { onConflict: 'user_id,local_date' }
    );
  });
});
