import { WeekDay } from './glow';
import { deriveCheckinAccent } from './practice-accent';
import { ShareCard } from './shareCards';

// SC2 (18 July) — client-side slot filling for the warm-journey and
// dot-strip card flavors (Rally21-Share-Cards-Spec.md §4.2/§4.3). The
// server (get_share_card_for_today) picks WHICH template serves; the
// slot values are circle facts only the client has in hand at the
// check-in moment (the p_is_rekindle pattern) — day number, own
// check-in count, the practice-accent noun. Deterministic only, zero
// LLM, and by construction no private content: no reflection text, no
// mood, ever reaches a fill call.

/** Number words for the small counts these cards actually show (journey
 * days and check-in counts live in the 1–21 neighborhood); anything
 * past twenty falls back to digits, which reads fine at that size. */
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

export function numberWord(n: number): string {
  if (!Number.isInteger(n) || n < 0) return String(n);
  return n <= 20 ? NUMBER_WORDS[n] : String(n);
}

export type JourneySlots = {
  /** The circle's journey day number (checkin-complete's own dayNumber). */
  day: number;
  /** Own self check-ins in this circle; null when the count fetch failed. */
  timesShown: number | null;
  /** deriveCheckinAccent(practiceName) — already falls back to "practice". */
  practiceNoun: string;
};

/**
 * Fills a journey template's {slot} placeholders. Returns null if any
 * placeholder survives the fill (an unknown slot name, or a count slot
 * on a null count) — the caller must treat null as "no card today"
 * rather than ever showing raw braces. The server's needs_count gate
 * means a count slot should never meet a null/low count in practice;
 * this is the belt to that suspender.
 */
export function fillJourneyTemplate(body: string, slots: JourneySlots): string | null {
  let filled = body
    .replaceAll('{day}', String(slots.day))
    .replaceAll('{practiceNoun}', slots.practiceNoun);
  if (slots.timesShown !== null && slots.timesShown >= 2) {
    filled = filled
      .replaceAll('{count}', String(slots.timesShown))
      .replaceAll('{countWord}', numberWord(slots.timesShown));
  }
  if (/\{[a-zA-Z]+\}/.test(filled)) return null;
  return filled;
}

/** "week three" — the journey week the circle is in, from its day
 * number (day 1–7 = week one, 8–14 = week two, ...). */
export function journeyWeekNumber(journeyDay: number): number {
  return Math.max(1, Math.ceil(journeyDay / 7));
}

/**
 * The dot strip's one line (spec §4.3's "week three of morning pages"
 * family), under Cat's 17 July ruling on §9 Q3: the practice name is ON
 * the card by default, with the share-preview's one-tap toggle to the
 * generic form. Curly quotes around the name keep ANY stored name
 * grammatical in the "week three of …" shape (practice names are verb
 * phrases by convention — "week three of Meditate 10 minutes" only
 * reads as a title, not a sentence fragment, when quoted); the generic
 * form drops the quotes since it's plain prose.
 */
export function dotStripLine(weekNumber: number, practiceName: string | null): string {
  const week = `week ${numberWord(weekNumber)}`;
  if (!practiceName) return `${week} of your daily practice`;
  return `${week} of “${practiceName}”`;
}

/**
 * Turns the RPC's pick into the /share-card route params — the one
 * place a card's client-known facts get baked in. Journey templates are
 * filled HERE (checkin-complete is the only caller with the circle in
 * hand); a fill that can't complete returns null and the slot quietly
 * doesn't fire, rather than ever rendering raw {braces}. The dot strip
 * rides as data (week + weekNumber + practiceName) because its line is
 * composed on /share-card itself, under the name-consent toggle.
 */
export function buildShareCardNavParams(
  card: ShareCard,
  ctx: {
    week: WeekDay[];
    dayNumber: number;
    timesShown: number | null;
    practiceName: string | null;
  }
): Record<string, string> | null {
  if (card.flavor === 'warm_journey') {
    const filled = fillJourneyTemplate(card.body, {
      day: ctx.dayNumber,
      timesShown: ctx.timesShown,
      practiceNoun: deriveCheckinAccent(ctx.practiceName),
    });
    if (!filled) return null;
    return {
      flavor: card.flavor,
      cardKey: card.cardKey,
      body: filled,
      dayNumber: String(ctx.dayNumber),
    };
  }
  if (card.flavor === 'dot_strip') {
    if (ctx.week.length === 0) return null;
    return {
      flavor: card.flavor,
      cardKey: card.cardKey,
      week: JSON.stringify(ctx.week),
      weekNumber: String(journeyWeekNumber(ctx.dayNumber)),
      practiceName: ctx.practiceName ?? '',
    };
  }
  return {
    flavor: card.flavor,
    cardKey: card.cardKey,
    body: card.body,
    attribution: card.attribution ?? '',
    gloss: card.gloss ?? '',
  };
}
