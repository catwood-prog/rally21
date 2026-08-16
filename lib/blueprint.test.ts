import {
  BlueprintPattern,
  BlueprintResponse,
  deriveWantPhrase,
  deriveWantPracticeName,
  describeConfidence,
  selectBlueprintCards,
} from './blueprint';

describe('describeConfidence', () => {
  it('does not surface a trait below the 0.4 floor', () => {
    expect(describeConfidence(0.39)).toBeNull();
    expect(describeConfidence(0)).toBeNull();
  });

  it('renders confidence as words, never numbers', () => {
    expect(describeConfidence(0.4)).toBe('hunch');
    expect(describeConfidence(0.59)).toBe('hunch');
    expect(describeConfidence(0.6)).toBe('fairly sure');
    expect(describeConfidence(0.79)).toBe('fairly sure');
    expect(describeConfidence(0.8)).toBe('solid');
    expect(describeConfidence(1)).toBe('solid');
  });
});

describe('deriveWantPracticeName', () => {
  it('strips the "you keep reaching for" framing and capitalizes', () => {
    expect(deriveWantPracticeName('You keep reaching for a calmer morning routine.')).toBe(
      'A calmer morning routine'
    );
  });

  it('is case-insensitive on the framing prefix', () => {
    expect(deriveWantPracticeName('you keep reaching for quiet time.')).toBe('Quiet time');
  });

  it('falls back to the full statement when the framing is absent', () => {
    expect(deriveWantPracticeName('More quiet mornings.')).toBe('More quiet mornings');
  });
});

describe('deriveWantPhrase', () => {
  it('strips the framing and lowercases for mid-sentence use', () => {
    expect(deriveWantPhrase('You keep reaching for a calmer morning routine.')).toBe(
      'a calmer morning routine'
    );
  });
});

/** BP1 — the two lists that used to overlap. The screen-level proof lives
 * in screens-tests/private-map-answer-state.test.tsx; these pin the
 * derivation itself, including the cases the screen can't reach today. */
describe('selectBlueprintCards', () => {
  const pattern = (patternKey: string, patternType: BlueprintPattern['patternType'] = 'consistency'): BlueprintPattern => ({
    patternKey,
    patternType,
    weekday: null,
    direction: null,
    cutoffHour: 9,
    agreementCount: 5,
    totalCount: 6,
    evidenceRate: 0.83,
    statement: null,
    contrast: null,
  });
  const answer = (patternKey: string, response: BlueprintResponse['response']): BlueprintResponse => ({
    patternKey,
    response,
    note: null,
  });

  it('renders an unanswered pattern as the active card and nowhere else', () => {
    const { activePattern, confirmedPatterns } = selectBlueprintCards(
      [pattern('consistency')],
      [],
      'consistency'
    );
    expect(activePattern?.patternKey).toBe('consistency');
    expect(confirmedPatterns).toEqual([]);
  });

  it('THE BUG: a confirmed pattern leaves the active slot instead of appearing twice', () => {
    // Against HEAD this returned the pattern in BOTH lists — the active
    // card kept its live "sounds right / not quite" buttons while the same
    // pattern also rendered below as answered.
    const { activePattern, confirmedPatterns } = selectBlueprintCards(
      [pattern('consistency')],
      [answer('consistency', 'confirmed')],
      'consistency'
    );
    expect(activePattern).toBeNull();
    expect(confirmedPatterns.map((p) => p.patternKey)).toEqual(['consistency']);
  });

  it('a not_quite pattern renders in neither list — there is no answered copy for it', () => {
    const { activePattern, confirmedPatterns } = selectBlueprintCards(
      [pattern('consistency')],
      [answer('consistency', 'not_quite')],
      'consistency'
    );
    expect(activePattern).toBeNull();
    expect(confirmedPatterns).toEqual([]);
  });

  it('a changed answer is read from the LAST entry for that key, never the first', () => {
    // Mirrors the upsert: one pattern, one answer, and it is the newest.
    const { activePattern, confirmedPatterns } = selectBlueprintCards(
      [pattern('consistency')],
      [answer('consistency', 'confirmed'), answer('consistency', 'not_quite')],
      'consistency'
    );
    expect(activePattern).toBeNull();
    expect(confirmedPatterns).toEqual([]);
  });

  it('answering one pattern leaves another pattern’s active card alone', () => {
    const { activePattern, confirmedPatterns } = selectBlueprintCards(
      [pattern('consistency'), pattern('time_of_day_before_noon_higher', 'time_of_day_mood')],
      [answer('consistency', 'confirmed')],
      'time_of_day_before_noon_higher'
    );
    expect(activePattern?.patternKey).toBe('time_of_day_before_noon_higher');
    expect(confirmedPatterns.map((p) => p.patternKey)).toEqual(['consistency']);
  });

  it('a confirmed WANT stays out of the answered list — it has its own card', () => {
    const { confirmedPatterns } = selectBlueprintCards(
      [pattern('want_calmer_mornings', 'synthesis_want')],
      [answer('want_calmer_mornings', 'confirmed')],
      null
    );
    expect(confirmedPatterns).toEqual([]);
  });
});
