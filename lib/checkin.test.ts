import { isReflectionSubstantive } from './checkin';

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
