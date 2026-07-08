// BD1 — birthdays. Day + month are collected together; the year is always
// optional and, when given, is NEVER displayed or turned into an age
// anywhere (spec §5). These helpers are pure so the pickers, the celebration
// gates, and the tests all share one definition of "valid" and "today".

export const MONTHS: { value: number; label: string; full: string }[] = [
  { value: 1, label: 'Jan', full: 'January' },
  { value: 2, label: 'Feb', full: 'February' },
  { value: 3, label: 'Mar', full: 'March' },
  { value: 4, label: 'Apr', full: 'April' },
  { value: 5, label: 'May', full: 'May' },
  { value: 6, label: 'Jun', full: 'June' },
  { value: 7, label: 'Jul', full: 'July' },
  { value: 8, label: 'Aug', full: 'August' },
  { value: 9, label: 'Sep', full: 'September' },
  { value: 10, label: 'Oct', full: 'October' },
  { value: 11, label: 'Nov', full: 'November' },
  { value: 12, label: 'Dec', full: 'December' },
];

/** Days selectable for a birthday month. February allows 29 (leap-day
 * birthdays are real and yearless), so this is intentionally NOT a
 * calendar-year day count — it's the set of valid birthday days. */
export function daysInMonth(month: number): number {
  if (month === 2) return 29;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/** A birthday is either fully unset (no month, no day) or a valid
 * month+day pair; the year is optional and, if present, must be plausible.
 * Mirrors the DB check constraint exactly so the client rejects the same
 * inputs the database would (e.g. Feb 31). */
export function isValidBirthday(
  month: number | null,
  day: number | null,
  year: number | null = null
): boolean {
  if (year != null && (year < 1900 || year > new Date().getFullYear())) return false;
  if (month == null && day == null) return true;
  if (month == null || day == null) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(month);
}

/** True when a YYYY-MM-DD local date (already resolved to the relevant
 * person's own timezone) falls on the given birthday month+day. Exact
 * match only — a Feb 29 birthday celebrates on Feb 29, i.e. in leap years
 * (predictable and never double-fires). */
export function isBirthdayToday(
  month: number | null,
  day: number | null,
  localDate: string
): boolean {
  if (month == null || day == null) return false;
  const parts = localDate.split('-');
  if (parts.length !== 3) return false;
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return m === month && d === day;
}
