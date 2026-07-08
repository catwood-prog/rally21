import { daysInMonth, isBirthdayToday, isValidBirthday, MONTHS } from './birthday';

describe('MONTHS', () => {
  it('covers all 12 months in order', () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS.map((m) => m.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('daysInMonth', () => {
  it('allows Feb 29 (leap-day birthdays are real)', () => {
    expect(daysInMonth(2)).toBe(29);
  });
  it('returns 30 for 30-day months', () => {
    for (const m of [4, 6, 9, 11]) expect(daysInMonth(m)).toBe(30);
  });
  it('returns 31 for 31-day months', () => {
    for (const m of [1, 3, 5, 7, 8, 10, 12]) expect(daysInMonth(m)).toBe(31);
  });
});

describe('isValidBirthday', () => {
  it('accepts a fully unset birthday', () => {
    expect(isValidBirthday(null, null)).toBe(true);
    expect(isValidBirthday(null, null, null)).toBe(true);
  });
  it('rejects a half-set birthday (month or day alone)', () => {
    expect(isValidBirthday(3, null)).toBe(false);
    expect(isValidBirthday(null, 15)).toBe(false);
  });
  it('accepts a valid month+day', () => {
    expect(isValidBirthday(1, 1)).toBe(true);
    expect(isValidBirthday(12, 31)).toBe(true);
    expect(isValidBirthday(2, 29)).toBe(true); // leap-day birthday
  });
  it('rejects Feb 30 / Feb 31 and day 31 in 30-day months', () => {
    expect(isValidBirthday(2, 30)).toBe(false);
    expect(isValidBirthday(2, 31)).toBe(false);
    expect(isValidBirthday(4, 31)).toBe(false);
    expect(isValidBirthday(6, 31)).toBe(false);
  });
  it('rejects out-of-range month/day', () => {
    expect(isValidBirthday(0, 10)).toBe(false);
    expect(isValidBirthday(13, 10)).toBe(false);
    expect(isValidBirthday(5, 0)).toBe(false);
    expect(isValidBirthday(5, 32)).toBe(false);
  });
  it('accepts a null year and a plausible year, rejects implausible years', () => {
    expect(isValidBirthday(5, 10, null)).toBe(true);
    expect(isValidBirthday(5, 10, 1990)).toBe(true);
    expect(isValidBirthday(5, 10, 1899)).toBe(false);
    expect(isValidBirthday(5, 10, new Date().getFullYear() + 1)).toBe(false);
  });
});

describe('isBirthdayToday', () => {
  it('matches on month+day of a local date string, ignoring year', () => {
    expect(isBirthdayToday(7, 8, '2026-07-08')).toBe(true);
    expect(isBirthdayToday(7, 8, '1999-07-08')).toBe(true);
  });
  it('does not match a different day or month', () => {
    expect(isBirthdayToday(7, 8, '2026-07-09')).toBe(false);
    expect(isBirthdayToday(7, 8, '2026-08-08')).toBe(false);
  });
  it('is false when the birthday is unset', () => {
    expect(isBirthdayToday(null, null, '2026-07-08')).toBe(false);
    expect(isBirthdayToday(7, null, '2026-07-08')).toBe(false);
    expect(isBirthdayToday(null, 8, '2026-07-08')).toBe(false);
  });
  it('a Feb 29 birthday matches only on Feb 29', () => {
    expect(isBirthdayToday(2, 29, '2024-02-29')).toBe(true);
    expect(isBirthdayToday(2, 29, '2025-02-28')).toBe(false);
    expect(isBirthdayToday(2, 29, '2025-03-01')).toBe(false);
  });
});
