import { isResting, RESTING_QUIET_DAYS_THRESHOLD } from './resting';

describe('isResting', () => {
  test('fresh joiner with zero completions never reads resting', () => {
    expect(
      isResting({ joinedLocalDate: '2026-07-12', presenceLocalDates: [], today: '2026-07-13' })
    ).toBe(false);
  });

  test('a covered completion 2 days ago reads active', () => {
    expect(
      isResting({
        joinedLocalDate: '2026-06-01',
        presenceLocalDates: ['2026-07-11'],
        today: '2026-07-13',
      })
    ).toBe(false);
  });

  test('last completion 6 days old reads resting', () => {
    expect(
      isResting({
        joinedLocalDate: '2026-06-01',
        presenceLocalDates: ['2026-07-07'],
        today: '2026-07-13',
      })
    ).toBe(true);
  });

  test('the 5-day boundary itself already reads resting', () => {
    expect(RESTING_QUIET_DAYS_THRESHOLD).toBe(5);
    expect(
      isResting({
        joinedLocalDate: '2026-06-01',
        presenceLocalDates: ['2026-07-08'],
        today: '2026-07-13',
      })
    ).toBe(true);
  });

  test('4 quiet days is not yet resting', () => {
    expect(
      isResting({
        joinedLocalDate: '2026-06-01',
        presenceLocalDates: ['2026-07-09'],
        today: '2026-07-13',
      })
    ).toBe(false);
  });

  test('return-on-check-in: a completion today always reads active regardless of history', () => {
    expect(
      isResting({
        joinedLocalDate: '2026-06-01',
        presenceLocalDates: ['2026-06-05', '2026-07-13'],
        today: '2026-07-13',
      })
    ).toBe(false);
  });

  test('never completed, but joined only 5 days ago, is exempt (not yet "more than 5 days")', () => {
    expect(
      isResting({ joinedLocalDate: '2026-07-08', presenceLocalDates: [], today: '2026-07-13' })
    ).toBe(false);
  });

  test('never completed and joined 6 days ago reads resting', () => {
    expect(
      isResting({ joinedLocalDate: '2026-07-07', presenceLocalDates: [], today: '2026-07-13' })
    ).toBe(true);
  });

  test('multiple presence rows: only the most recent one matters', () => {
    expect(
      isResting({
        joinedLocalDate: '2026-06-01',
        presenceLocalDates: ['2026-07-13', '2026-06-20', '2026-06-25'],
        today: '2026-07-13',
      })
    ).toBe(false);
  });
});
