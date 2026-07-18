/**
 * A check-in counts for the user's LOCAL calendar day, not a server UTC
 * day (see build audit, "day boundary and timezone"). getFullYear/getMonth/
 * getDate all read the device's local clock, so this stays correct across
 * timezones without ever touching UTC.
 */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDeviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The YYYY-MM-DD local date in a specific IANA timezone — used to resolve
 * another person's "today" (e.g. a circle-mate's birthday) against THEIR
 * clock rather than the viewer's device. Mirrors compose-digest's own
 * localDateString helper so client and server agree. Falls back to the
 * device-local date when tz is missing or invalid. */
export function localDateStringInTimeZone(timeZone: string | null | undefined, date: Date = new Date()): string {
  if (!timeZone) return getLocalDateString(date);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // invalid tz string — fall through to device-local
  }
  return getLocalDateString(date);
}

/** Calendar days between two local-date strings (YYYY-MM-DD), built from
 * UTC(Y, M, D) so the subtraction is never skewed by DST. */
/** Shift a YYYY-MM-DD date by whole days in UTC (DST-proof — the same
 * derivation daysBetween below uses; mirrors the edge functions' own
 * shiftDate). */
export function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate()
  ).padStart(2, '0')}`;
}

export function daysBetween(fromLocalDate: string, toLocalDate: string): number {
  const [fy, fm, fd] = fromLocalDate.split('-').map(Number);
  const [ty, tm, td] = toLocalDate.split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}
