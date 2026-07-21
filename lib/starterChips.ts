import { STRINGS } from '@/constants/strings';

import { WeekDay } from './glow';

// PM1B (21 July) — the starter-chip set, shared by the private map's
// invitation card and the Ask Rally screen's own chip grid. The one rule
// that matters: "how do I get back on track?" may only ever render on a
// genuinely missed-yesterday day — a false "you lapsed" signal is the one
// failure mode this feature cannot have.

/** Whether the user genuinely missed yesterday, read from the same week
 * row the restart logic uses (get_my_week via getMyWeek — see
 * didRekindleToday in lib/glow.ts: a missed, uncovered day always reads
 * 'none', while a covered day reads 'held' and is NOT a miss). The
 * second condition — some day before yesterday shows practice — is the
 * no-yesterday-to-miss guard: a brand-new or mid-onboarding user (or
 * anyone whose visible week holds no practice at all, whom welcome-back
 * re-entry already greets) gets the standard four chips, never a lapse
 * signal built from an empty history. */
export function missedYesterday(week: WeekDay[]): boolean {
  if (week.length < 2) return false;
  const yesterday = week[week.length - 2];
  if (yesterday.state !== 'none') return false;
  return week.slice(0, week.length - 2).some((day) => day.state !== 'none');
}

/** The four chips to render, in Cat's ruled order. On a missed-yesterday
 * day the recovery chip swaps IN as the second slot (displacing "what's
 * getting in my way lately?") — always four chips visible, never five. */
export function buildStarterChips(hasMissedYesterday: boolean): string[] {
  const chips: string[] = [...STRINGS.blueprintAskChips];
  if (hasMissedYesterday) chips[1] = STRINGS.askRallyRecoveryChip;
  return chips;
}
