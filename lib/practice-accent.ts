import { isVerbPhrasePractice } from '@/constants/strings';

const TIME_UNIT_WORDS = new Set([
  'minute',
  'minutes',
  'min',
  'mins',
  'hour',
  'hours',
  'hr',
  'hrs',
  'second',
  'seconds',
  'sec',
  'secs',
]);

const NUMBER_WORDS = new Set([
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]);

// Verbs whose literal noun form doesn't read naturally in "close your ___" —
// mapped to the verb's actual noun form instead (meditate -> meditation, not
// "sit", which was itself broken: "close your sit"). Verbs not listed here
// read fine as-is (run, walk, stretch, read, draw, journal — "close your
// run" reads naturally without any override) and pass straight through via
// verbAccent's own fallback to the bare verb.
const VERB_OVERRIDES: Record<string, string> = {
  meditate: 'meditation',
  sit: 'sitting',
  breathe: 'breathing',
  move: 'movement',
  practice: 'practice',
  do: 'practice',
  write: 'writing',
};

// These verbs' own noun form reads better than any object derived from the
// rest of the phrase — "Write one page" should read "close your writing",
// not "close your pages" (which reads like closing a book, not finishing a
// writing session).
const VERBS_PREFER_OWN_ACCENT = new Set(['write']);

function isQuantityToken(token: string): boolean {
  return /^\d+$/.test(token) || /^\d+[a-z]+$/.test(token) || NUMBER_WORDS.has(token);
}

function pluralize(word: string): string {
  if (word.endsWith('s')) return word;
  if (/(?:s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

function verbAccent(verb: string): string | null {
  if (!/^[a-z]+$/.test(verb) || verb.length < 2) return null;
  return VERB_OVERRIDES[verb] ?? verb;
}

/**
 * Derives the check-in headline's serif-italic accent word from a practice
 * name — "Meditate 10 minutes" -> "sit", "Run 5k" -> "run", "Write one page"
 * -> "pages". Seeded practices follow the verb-phrase convention (see
 * CLAUDE.md's resilient-headline rule), typically verb + quantity + [unit
 * or object]; a custom name can be anything, so anything that doesn't
 * start with a recognized verb (same list the Today headline checks) falls
 * back to "practice" rather than risk a word that reads oddly.
 */
export function deriveCheckinAccent(practiceName: string | null | undefined): string {
  const fallback = 'practice';
  if (!practiceName) return fallback;
  if (!isVerbPhrasePractice(practiceName)) return fallback;

  const tokens = practiceName
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);

  if (tokens.length === 0) return fallback;
  if (tokens.length === 1) return verbAccent(tokens[0]) ?? fallback;

  const verb = tokens[0];
  const quantityIndex = tokens.findIndex((t, i) => i > 0 && isQuantityToken(t));
  if (quantityIndex === -1) return fallback;

  const rest = tokens.slice(quantityIndex + 1);
  if (rest.length === 0 || rest.every((t) => TIME_UNIT_WORDS.has(t)) || VERBS_PREFER_OWN_ACCENT.has(verb)) {
    return verbAccent(verb) ?? fallback;
  }

  const lastWord = rest[rest.length - 1];
  if (!/^[a-z]+$/.test(lastWord) || lastWord.length < 2) return fallback;
  return pluralize(lastWord);
}
