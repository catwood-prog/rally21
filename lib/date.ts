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

/** Calendar days between two local-date strings (YYYY-MM-DD), built from
 * UTC(Y, M, D) so the subtraction is never skewed by DST. */
export function daysBetween(fromLocalDate: string, toLocalDate: string): number {
  const [fy, fm, fd] = fromLocalDate.split('-').map(Number);
  const [ty, tm, td] = toLocalDate.split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}
