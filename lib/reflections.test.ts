/**
 * HY1 job 6 (R8) — lib/reflections.ts, first test.
 *
 * This module is read by the journal, the weekly look-back, /reflection's
 * day-14 observation, the Map tab's notification dot and Ask Rally's
 * context count, and every one of those surfaces makes a CLAIM ABOUT THE
 * PERSON from what it returns. So the tests below are mostly honesty
 * tests, not arithmetic ones — the failures worth catching are the ones
 * where the app says something true-sounding and wrong:
 *
 *   - retelling a past day's question in the bank's CURRENT wording
 *     (MN2's live bug: 57 stored snapshots already differ),
 *   - showing an empty question-pin stub as a day the person wrote,
 *   - reading "1 of 7" on a circle that is two days old,
 *   - surfacing a "pattern" off four data points.
 */
import {
  computeByCircleShowUp,
  computeDayObservation,
  computeWeeklyLookback,
  getMySubstantiveReflectionCount,
  hasUnrespondedDayObservation,
  Reflection,
  resolveQuestionPrompt,
} from './reflections';
import { isReflectionSubstantive } from './checkin';
import { MyCircle } from './circle';
import { supabase } from './supabase';

function reflection(overrides: Partial<Reflection> = {}): Reflection {
  return {
    id: 'r-1',
    localDate: '2026-08-01',
    mood: 3,
    line1: 'grateful for the quiet',
    line2: null,
    line2PromptKey: null,
    questionPrompt: null,
    questionAnswer: null,
    createdAt: '2026-08-01T09:00:00Z',
    ...overrides,
  };
}

function fakeCircle(overrides: Partial<MyCircle> = {}): MyCircle {
  return {
    id: 'circle-1',
    name: 'Morning Movers',
    timeOfDay: '08:00:00',
    startDate: '2026-06-01',
    durationDays: 21,
    practiceName: 'Walk 20 minutes',
    practiceIsUserCreated: false,
    durationMinutes: 20,
    inviteCode: 'ABC123',
    createdBy: 'user-1',
    resourceUrl: null,
    instructions: null,
    isPublic: false,
    closedToJoins: false,
    ralliedOnAt: null,
    completedAt: null,
    myJoinSource: null,
    ...overrides,
  };
}

// ── resolveQuestionPrompt — the two honesty rules ────────────────────────

describe('resolveQuestionPrompt', () => {
  test('the STORED SNAPSHOT wins over the bank’s current wording', () => {
    // MN2 (Cat’s ruling, 30 July): the snapshot is what this person was
    // actually shown that day. Preferring the live join would make the
    // journal retell their history in words nobody ever asked them.
    expect(
      resolveQuestionPrompt({
        question_prompt_snapshot: 'what felt easy today?',
        questions: { prompt: 'what came easily to you today?' },
      })
    ).toBe('what felt easy today?');
  });

  test('the live join is the FALLBACK for pre-snapshot rows, not the default', () => {
    expect(
      resolveQuestionPrompt({
        question_prompt_snapshot: null,
        questions: { prompt: 'what came easily to you today?' },
      })
    ).toBe('what came easily to you today?');
  });

  test('accent markers come off either way — the journal renders plain text', () => {
    expect(
      resolveQuestionPrompt({
        question_prompt_snapshot: 'what felt *easy* today?',
        questions: null,
      })
    ).toBe('what felt easy today?');
  });

  test('no question at all stays null rather than becoming an empty string', () => {
    // A null means "this day had no question"; '' would render as a
    // question that was asked and left blank.
    expect(resolveQuestionPrompt({ question_prompt_snapshot: null, questions: null })).toBeNull();
  });
});

// ── computeWeeklyLookback ────────────────────────────────────────────────

describe('computeWeeklyLookback', () => {
  test('a day-3 circle reads "of 3", never "of 7" with four empty days behind it', () => {
    const result = computeWeeklyLookback(
      [reflection({ localDate: '2026-06-03' })],
      '2026-06-03',
      '2026-06-01'
    );
    expect(result.totalDays).toBe(3);
    expect(result.daysShowedUp).toBe(1);
    expect(result.dates).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
  });

  test('an established circle caps the window at 7', () => {
    const result = computeWeeklyLookback([], '2026-08-01', '2026-06-01');
    expect(result.totalDays).toBe(7);
    expect(result.dailyMoods).toHaveLength(7);
  });

  test('moods land oldest-to-newest, with a null for a day not written', () => {
    const result = computeWeeklyLookback(
      [reflection({ localDate: '2026-06-01', mood: 2 }), reflection({ id: 'r-2', localDate: '2026-06-03', mood: 5 })],
      '2026-06-03',
      '2026-06-01'
    );
    expect(result.dailyMoods).toEqual([2, null, 5]);
  });

  test('reflections outside the window never inflate the count', () => {
    const result = computeWeeklyLookback(
      [reflection({ localDate: '2026-05-20' }), reflection({ id: 'r-2', localDate: '2026-06-02' })],
      '2026-06-03',
      '2026-06-01'
    );
    expect(result.daysShowedUp).toBe(1);
  });

  test('two rows on the same day count as ONE day shown up', () => {
    // A person in two circles can write twice; "days showed up" is a
    // count of DAYS, and double-counting would overstate their week.
    const result = computeWeeklyLookback(
      [
        reflection({ localDate: '2026-06-02', mood: 4 }),
        reflection({ id: 'r-2', localDate: '2026-06-02', mood: 1 }),
      ],
      '2026-06-03',
      '2026-06-01'
    );
    expect(result.daysShowedUp).toBe(1);
  });

  test('the standout is the longest line from a best-mood day, labelled by which line it was', () => {
    const result = computeWeeklyLookback(
      [
        reflection({ localDate: '2026-06-01', mood: 5, line1: 'short', line2: 'a much longer learned line' }),
        reflection({ id: 'r-2', localDate: '2026-06-02', mood: 2, line1: 'an even longer line than that one here' }),
      ],
      '2026-06-02',
      '2026-06-01'
    );
    expect(result.standout).toEqual({
      text: 'a much longer learned line',
      label: 'learned',
      date: '2026-06-01',
    });
  });

  test('an empty week has no standout rather than an empty one', () => {
    const result = computeWeeklyLookback([], '2026-06-03', '2026-06-01');
    expect(result.standout).toBeNull();
    expect(result.daysShowedUp).toBe(0);
  });
});

// ── computeByCircleShowUp ────────────────────────────────────────────────

describe('computeByCircleShowUp', () => {
  const today = '2026-06-07';

  test('each circle gets its OWN window from its own start date', () => {
    const rows = computeByCircleShowUp(
      [
        fakeCircle({ id: 'old', name: 'Old', startDate: '2026-05-01' }),
        fakeCircle({ id: 'new', name: 'New', startDate: '2026-06-06' }),
      ],
      [],
      today
    );
    expect(rows[0].totalDays).toBe(7);
    // Two days old — "0 of 7" would invent five days it never existed for.
    expect(rows[1].totalDays).toBe(2);
  });

  test('completions from another circle never count toward this one', () => {
    const rows = computeByCircleShowUp(
      [fakeCircle({ id: 'a' }), fakeCircle({ id: 'b', name: 'B' })],
      [
        { circleId: 'a', localDate: '2026-06-05' },
        { circleId: 'b', localDate: '2026-06-06' },
        { circleId: 'b', localDate: '2026-06-07' },
      ],
      today
    );
    expect(rows.find((r) => r.circleId === 'a')!.daysShowedUp).toBe(1);
    expect(rows.find((r) => r.circleId === 'b')!.daysShowedUp).toBe(2);
  });

  test('two completions on one day are one day, not two', () => {
    const rows = computeByCircleShowUp(
      [fakeCircle({ id: 'a' })],
      [
        { circleId: 'a', localDate: '2026-06-06' },
        { circleId: 'a', localDate: '2026-06-06' },
      ],
      today
    );
    expect(rows[0].daysShowedUp).toBe(1);
  });

  test('isHot mirrors the signal’s glowing threshold at exactly 70%', () => {
    const dates = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'];
    const rows = computeByCircleShowUp(
      [fakeCircle({ id: 'a', startDate: '2026-05-01' })],
      dates.map((localDate) => ({ circleId: 'a', localDate })),
      today
    );
    // 5 of 7 = 0.714 — over the line.
    expect(rows[0].isHot).toBe(true);

    const cooler = computeByCircleShowUp(
      [fakeCircle({ id: 'a', startDate: '2026-05-01' })],
      dates.slice(0, 4).map((localDate) => ({ circleId: 'a', localDate })),
      today
    );
    // 4 of 7 = 0.571 — under it.
    expect(cooler[0].isHot).toBe(false);
  });
});

// ── computeDayObservation ────────────────────────────────────────────────

function moodDays(entries: { date: string; hour: number; mood: number }[]): Reflection[] {
  return entries.map((e, i) =>
    reflection({
      id: `r-${i}`,
      localDate: e.date,
      mood: e.mood,
      createdAt: `${e.date}T${String(e.hour).padStart(2, '0')}:00:00`,
    })
  );
}

describe('computeDayObservation', () => {
  test('fewer than 10 data points is NOT a pattern — it reports how few it has', () => {
    // The screen shows its "grows as you go" state off this. Surfacing a
    // "pattern" from four days would be the app making something up.
    const result = computeDayObservation(
      moodDays([
        { date: '2026-06-01', hour: 8, mood: 5 },
        { date: '2026-06-02', hour: 8, mood: 5 },
        { date: '2026-06-03', hour: 20, mood: 1 },
        { date: '2026-06-04', hour: 20, mood: 1 },
      ])
    );
    expect(result).toEqual({ available: false, dataPoints: 4 });
  });

  test('reflections with no mood are not data points', () => {
    const result = computeDayObservation([
      ...moodDays(Array.from({ length: 6 }, (_, i) => ({ date: `2026-06-0${i + 1}`, hour: 8, mood: 4 }))),
      reflection({ id: 'no-mood', mood: null }),
    ]);
    expect(result).toEqual({ available: false, dataPoints: 6 });
  });

  test('a clean morning-vs-evening split surfaces as before_noon_higher', () => {
    const result = computeDayObservation(
      moodDays([
        { date: '2026-06-01', hour: 8, mood: 5 },
        { date: '2026-06-02', hour: 8, mood: 5 },
        { date: '2026-06-03', hour: 9, mood: 5 },
        { date: '2026-06-04', hour: 9, mood: 4 },
        { date: '2026-06-05', hour: 8, mood: 5 },
        { date: '2026-06-06', hour: 20, mood: 1 },
        { date: '2026-06-07', hour: 20, mood: 1 },
        { date: '2026-06-08', hour: 21, mood: 2 },
        { date: '2026-06-09', hour: 19, mood: 1 },
        { date: '2026-06-10', hour: 20, mood: 1 },
      ])
    );
    expect(result.available).toBe(true);
    if (!result.available) throw new Error('unreachable');
    expect(result.type).toBe('time_of_day');
    expect(result.direction).toBe('before_noon_higher');
    expect(result.totalCount).toBe(10);
  });

  test('the reverse split surfaces as after_noon_higher, not a flipped label', () => {
    const result = computeDayObservation(
      moodDays([
        { date: '2026-06-01', hour: 8, mood: 1 },
        { date: '2026-06-02', hour: 8, mood: 1 },
        { date: '2026-06-03', hour: 9, mood: 2 },
        { date: '2026-06-04', hour: 9, mood: 1 },
        { date: '2026-06-05', hour: 8, mood: 1 },
        { date: '2026-06-06', hour: 20, mood: 5 },
        { date: '2026-06-07', hour: 20, mood: 5 },
        { date: '2026-06-08', hour: 21, mood: 4 },
        { date: '2026-06-09', hour: 19, mood: 5 },
        { date: '2026-06-10', hour: 20, mood: 5 },
      ])
    );
    if (!result.available) throw new Error('expected a pattern');
    expect(result.direction).toBe('after_noon_higher');
  });

  test('one group with no members at all is not a comparison', () => {
    // Ten morning check-ins say nothing about afternoons. A split needs
    // both sides or there is nothing to compare.
    const result = computeDayObservation(
      moodDays(
        Array.from({ length: 12 }, (_, i) => ({
          date: `2026-06-${String(i + 1).padStart(2, '0')}`,
          hour: 8,
          mood: i % 2 ? 4 : 2,
        }))
      )
    );
    // The time-of-day split is degenerate; only weekday/weekend can speak.
    if (result.available) expect(result.type).toBe('weekday');
  });

  test('only the last 14 moods are considered', () => {
    const many = moodDays(
      Array.from({ length: 20 }, (_, i) => ({
        date: `2026-06-${String(i + 1).padStart(2, '0')}`,
        hour: 8,
        mood: 3,
      }))
    );
    const result = computeDayObservation(many);
    if (result.available) expect(result.totalCount).toBeLessThanOrEqual(14);
    else expect(result.dataPoints).toBe(14);
  });
});

// ── the reads that decide what the app claims ────────────────────────────

describe('getMySubstantiveReflectionCount', () => {
  test('counts only substantive rows — a bare question-pin stub is not "a reflection we hold"', async () => {
    // Ask Rally's header says "using N reflections". Counting stubs would
    // promise the model context that does not exist.
    (supabase.from as jest.Mock).mockReturnValue({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: [
              { mood: 4, line1: 'wrote something' }, // both — counts
              { mood: null, line1: null }, // Q1's bare question-pin stub — does not
              { mood: null, line1: 'just a line' }, // a line alone — counts
              { mood: 2, line1: null }, // a mood alone — counts
              { mood: null, line1: null }, // another stub
            ],
            error: null,
          }),
      }),
    });

    await expect(getMySubstantiveReflectionCount('user-1')).resolves.toBe(3);
  });

  test('a whitespace-only line1 still counts — the rule is NOT-NULL, not non-blank', () => {
    // Pinned as OBSERVED, not endorsed: isReflectionSubstantive (lib/
    // checkin.ts) tests `line1 !== null`, so a row saved as '   ' is a
    // reflection everywhere this count is shown. Reachable only if a
    // write path ever stores un-trimmed whitespace; recorded here so a
    // future tightening is a deliberate change with a failing test
    // behind it, rather than a silent one.
    expect(isReflectionSubstantive({ mood: null, line1: '   ' })).toBe(true);
    expect(isReflectionSubstantive({ mood: null, line1: null })).toBe(false);
  });
});

describe('hasUnrespondedDayObservation (D6 — Today’s footer link and the Map tab’s dot)', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: `r-${i}`,
    local_date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    mood: i < 6 ? 5 : 1,
    line1: 'wrote something',
    line2: null,
    line2_prompt_key: null,
    question_answer: null,
    question_prompt_snapshot: null,
    created_at: `2026-06-${String(i + 1).padStart(2, '0')}T${i < 6 ? '08' : '20'}:00:00`,
    questions: null,
  }));

  function mockReflections(reflectionRows: unknown[]) {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'reflections') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ returns: () => Promise.resolve({ data: reflectionRows, error: null }) }) }),
          }),
        };
      }
      // observation_responses
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: responseRow, error: null }) }) }),
              }),
            }),
          }),
        }),
      };
    });
  }
  let responseRow: { response: string } | null = null;

  beforeEach(() => {
    responseRow = null;
    (supabase.from as jest.Mock).mockReset();
  });

  test('false when there is no pattern at all — the link never points at an empty screen', async () => {
    mockReflections(rows.slice(0, 3));
    await expect(hasUnrespondedDayObservation('user-1')).resolves.toBe(false);
  });

  test('true when a real pattern is waiting on an answer', async () => {
    mockReflections(rows);
    await expect(hasUnrespondedDayObservation('user-1')).resolves.toBe(true);
  });

  test('false once the person has already answered it', async () => {
    // The dot has to clear. Mirrors /reflection’s own render gate
    // exactly, which is why the two can never disagree.
    mockReflections(rows);
    responseRow = { response: 'confirmed' };
    await expect(hasUnrespondedDayObservation('user-1')).resolves.toBe(false);
  });
});
