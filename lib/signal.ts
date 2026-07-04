import { getLocalDateString } from './date';

export type SignalState = 'glowing' | 'warm' | 'resting';

export type PresenceRow = { userId: string; localDate: string };

/** `days` local date strings ending at `today`, oldest first. */
export function getTrailingLocalDates(today: string, days: number): string[] {
  const [y, m, d] = today.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(base);
    dt.setDate(base.getDate() - i);
    dates.push(getLocalDateString(dt));
  }
  return dates;
}

function daysBetween(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

export type Signal = {
  state: SignalState;
  rate: number;
  /** one entry per day in the window, oldest first, each 0-1 */
  dailyRates: number[];
  dates: string[];
  /** 1-indexed day of the circle (start date = day 1) */
  dayNumber: number;
};

/**
 * glow = check-in rate over the trailing window: glowing >= 70%, warm
 * 30-70%, resting < 30%. The window is min(7, days since the circle
 * started) — day 1 looks at a single day, growing to a full 7-day week by
 * day 7, rather than always dividing by 7 and rendering empty bars for
 * days before the circle existed. Any check-in today instantly floors the
 * state at "warm" — the signal should never look dead to someone who just
 * showed up.
 */
export function computeSignal(params: {
  presence: PresenceRow[];
  memberCount: number;
  today: string;
  circleStartDate: string;
}): Signal {
  const { presence, memberCount, today, circleStartDate } = params;

  const dayNumber = Math.max(1, daysBetween(circleStartDate, today) + 1);
  const windowSize = Math.min(7, dayNumber);
  const dates = getTrailingLocalDates(today, windowSize);

  const dailyCounts = dates.map(
    (date) => new Set(presence.filter((p) => p.localDate === date).map((p) => p.userId)).size
  );

  const totalCheckins = dailyCounts.reduce((sum, count) => sum + count, 0);
  const rate = memberCount > 0 ? totalCheckins / (memberCount * windowSize) : 0;

  let state: SignalState = rate >= 0.7 ? 'glowing' : rate >= 0.3 ? 'warm' : 'resting';

  const checkedInToday = dailyCounts[dailyCounts.length - 1] > 0;
  if (state === 'resting' && checkedInToday) {
    state = 'warm';
  }

  const dailyRates = dailyCounts.map((count) => (memberCount > 0 ? count / memberCount : 0));

  return { state, rate, dailyRates, dates, dayNumber };
}
