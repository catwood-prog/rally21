import { isReflectionSubstantive, resolveCheckinRoute } from './checkin';

describe('isReflectionSubstantive', () => {
  it('is false for a bare question-pin stub (Q1 get_daily_question) — mood and line1 both null', () => {
    expect(isReflectionSubstantive({ mood: null, line1: null })).toBe(false);
  });

  it('is true once mood is set, even with no grateful-for line yet', () => {
    expect(isReflectionSubstantive({ mood: 3, line1: null })).toBe(true);
  });

  it('is true once a grateful-for line is set, even with no mood yet', () => {
    expect(isReflectionSubstantive({ mood: null, line1: 'my friends' })).toBe(true);
  });

  it('is true once both are set', () => {
    expect(isReflectionSubstantive({ mood: 4, line1: 'coffee' })).toBe(true);
  });
});

describe('resolveCheckinRoute (SK1)', () => {
  const base = { hasSeenCheckinConsent: true, goesToActivityScreen: false, reflectionsOptOut: false };

  it('sends an ordinary check-in to the reflection screen', () => {
    expect(resolveCheckinRoute(base)).toBe('reflection');
  });

  it('sends a never-consented user to the intro first', () => {
    expect(resolveCheckinRoute({ ...base, hasSeenCheckinConsent: false })).toBe('intro');
  });

  it('sends an opted-out user straight to the one-tap flow', () => {
    expect(resolveCheckinRoute({ ...base, reflectionsOptOut: true })).toBe('one-tap');
  });

  it('SKIPS the reflection-consent intro when opted out — the intro is a pitch (no-nag law)', () => {
    expect(
      resolveCheckinRoute({ ...base, hasSeenCheckinConsent: false, reflectionsOptOut: true })
    ).toBe('one-tap');
  });

  it('keeps the timer / resource screen for an opted-out user — the sit is the practice, not the reflection', () => {
    expect(resolveCheckinRoute({ ...base, goesToActivityScreen: true, reflectionsOptOut: true })).toBe(
      'activity'
    );
  });

  it('keeps the activity screen ahead of the intro, exactly as before SK1', () => {
    expect(
      resolveCheckinRoute({ ...base, goesToActivityScreen: true, hasSeenCheckinConsent: false })
    ).toBe('activity');
  });
});
