import { deriveWantPhrase, deriveWantPracticeName, describeConfidence } from './blueprint';

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
