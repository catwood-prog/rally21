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

export type Signal = {
  state: SignalState;
  rate: number;
  /** one entry per trailing day, oldest first, each 0-1 */
  dailyRates: number[];
  dates: string[];
};

/**
 * glow = check-in rate over the trailing 7 days: glowing >= 70%, warm
 * 30-70%, resting < 30%. Days before the circle existed don't count against
 * it (a brand-new circle isn't "resting" on day one). Any check-in today
 * instantly floors the state at "warm" — the signal should never look dead
 * to someone who just showed up.
 */
export function computeSignal(params: {
  presence: PresenceRow[];
  memberCount: number;
  today: string;
  circleStartDate: string;
}): Signal {
  const { presence, memberCount, today, circleStartDate } = params;
  const dates = getTrailingLocalDates(today, 7);

  const dailyCounts = dates.map(
    (date) => new Set(presence.filter((p) => p.localDate === date).map((p) => p.userId)).size
  );

  const activeDayIndexes = dates
    .map((date, i) => ({ date, i }))
    .filter(({ date }) => date >= circleStartDate);
  const activeDayCount = Math.max(activeDayIndexes.length, 1);
  const totalCheckins = activeDayIndexes.reduce((sum, { i }) => sum + dailyCounts[i], 0);

  const rate = memberCount > 0 ? totalCheckins / (memberCount * activeDayCount) : 0;

  let state: SignalState = rate >= 0.7 ? 'glowing' : rate >= 0.3 ? 'warm' : 'resting';

  const checkedInToday = dailyCounts[dailyCounts.length - 1] > 0;
  if (state === 'resting' && checkedInToday) {
    state = 'warm';
  }

  const dailyRates = dailyCounts.map((count) => (memberCount > 0 ? count / memberCount : 0));

  return { state, rate, dailyRates, dates };
}
