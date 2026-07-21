import { daysBetween, getLocalDateString } from './date';

/**
 * GQ1 — the goals set (Rally21-Goals-Set-Spec.md, Cat's final wording
 * adopted VERBATIM, lowercase included). The check-in's second line is
 * one question per day from this fixed ten-question cycle: forward-
 * looking and intentional where the adaptive Q1 engine below it is
 * observational. Order is deliberate (1–3 an arc, 5 followed by 6's
 * easy win, 9 the outcome-feeling, 10 closes the cycle and mirrors the
 * Ask Rally chip) — never reorder without the spec.
 *
 * The isolation law (Cat, 21 July): each question is experienced ALONE
 * on its day, so every question names its own subject — no pronoun may
 * lean on another day's question. New questions go through the spec's
 * "Adding questions later" checklist, and this table + the spec update
 * together.
 */
export type GoalsSetQuestion = {
  /** Permanent identity, recorded on the reflection row AND the journal
   * label for that row's line2 — the two are the same by spec. */
  key: string;
  question: string;
  placeholder: string;
};

export const GOALS_SET_CYCLE: readonly GoalsSetQuestion[] = [
  { key: 'goal', question: "what's a goal that matters to you right now?", placeholder: 'big or small' },
  {
    key: 'step',
    question: "what's one small step you could take tomorrow towards your goals?",
    placeholder: 'tiny counts',
  },
  {
    key: 'space',
    question: 'what would make a little space to step toward your goals this week?',
    placeholder: 'one small opening',
  },
  { key: 'attention', question: 'where would you like to put more attention?', placeholder: 'one area is plenty' },
  {
    key: 'meaning to',
    question: "what have you been meaning to do, that hasn't happened yet?",
    placeholder: 'no judgement, just naming it',
  },
  { key: 'win', question: "what's one small win from today?", placeholder: 'anything that went right' },
  { key: 'learnt', question: 'one thing you have learnt recently', placeholder: 'anything you noticed' },
  {
    key: 'progress',
    question: 'where have you quietly made progress lately?',
    placeholder: 'small still counts',
  },
  {
    key: 'imagine',
    question: 'how will it feel when you reach your goals?',
    placeholder: 'picture it for a moment',
  },
  { key: 'honest', question: "what's been getting in your way lately?", placeholder: 'say it plainly, no blame' },
] as const;

/**
 * Cycle position for a local day — deterministic and stateless (spec
 * "Mechanics"): days since the account-creation LOCAL date, mod 10.
 * Same-day re-opens land on the same question by construction (input is
 * the date, not the time); a missed day's question is simply skipped and
 * the order marches on. Clamped so a clock-skewed "before creation" date
 * still wraps into the cycle instead of indexing negatively.
 */
export function goalsSetIndexForDates(createdLocalDate: string, localDate: string): number {
  const days = daysBetween(createdLocalDate, localDate);
  return ((days % GOALS_SET_CYCLE.length) + GOALS_SET_CYCLE.length) % GOALS_SET_CYCLE.length;
}

/**
 * The day's question for a user. `accountCreatedAt` is the auth user's
 * created_at timestamp (already on the session — no extra fetch);
 * it's interpreted in the DEVICE's timezone, matching the spec's "the
 * user's local date in their own timezone" and how the rest of the app
 * derives local dates (getLocalDateString).
 */
export function getGoalsSetQuestion(accountCreatedAt: string, localDate: string): GoalsSetQuestion {
  const createdLocalDate = getLocalDateString(new Date(accountCreatedAt));
  return GOALS_SET_CYCLE[goalsSetIndexForDates(createdLocalDate, localDate)];
}

/**
 * Journal label for a stored line2_prompt_key — the key IS the label
 * (spec table column "key (journal label)"). Old rows (null key, from
 * the "learned (optional)" era) and any unknown key render as
 * "learned", never a raw key leak.
 */
export function goalsSetLabelForKey(key: string | null): string {
  return GOALS_SET_CYCLE.find((q) => q.key === key)?.key ?? 'learned';
}
