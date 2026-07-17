/**
 * PT1 — the practice taxonomy (Rally21-Practice-Taxonomy-Spec.md).
 *
 * Three levels: domain (the big shelf, exactly six), practice type (the
 * fixed ~29-key unit for analytics and future public browsing — keys are
 * PERMANENT once shipped; display names can change), and the person's
 * free-text practice (level 3, unconstrained, lives on the row itself).
 *
 * The keyword sets drive guided creation: `classifyPracticeName` is the
 * deterministic pre-selector behind the "Learn · Read — sound right?"
 * chip. No LLM anywhere in this path, ever (spec hard rule). Keywords
 * grow over time from real miscategorisations — add here, with a test.
 */

// PT3 (17 July) — the re-cut to Cat's 16 July table: 18 keys, five
// domains (connect retired), affirm added, music moved make → learn.
// The retired keys were proven row-free live before the cut (the
// migration guards against replaying onto rows that use them).
export type PracticeDomain = 'move' | 'mind' | 'learn' | 'make' | 'care';

export type PracticeTypeKey =
  | 'walk' | 'run' | 'stretch' | 'strength' | 'sport' | 'dance'
  | 'meditate' | 'breathe' | 'journal' | 'gratitude' | 'affirm'
  | 'read' | 'language' | 'study' | 'music'
  | 'write' | 'art'
  | 'eat';

export type PracticeType = {
  domain: PracticeDomain;
  key: PracticeTypeKey;
  display: string;
  keywords: string[];
};

export const PRACTICE_DOMAINS: { key: PracticeDomain; display: string }[] = [
  { key: 'move', display: 'Move' },
  { key: 'mind', display: 'Mind' },
  { key: 'learn', display: 'Learn' },
  { key: 'make', display: 'Make' },
  { key: 'care', display: 'Care' },
];

/**
 * The type table, verbatim from the spec — table order IS the classifier
 * priority order (first type whose keywords match wins), which is what
 * makes the spec's boundary rulings hold: "morning pages" hits
 * mind/journal before make/write, "music theory course" hits learn/study
 * before make/music, "bake" hits make/craft before care/eat.
 */
export const PRACTICE_TYPES: PracticeType[] = [
  { domain: 'move', key: 'walk', display: 'Walk', keywords: ['walk', 'steps', 'stroll', 'hike'] },
  { domain: 'move', key: 'run', display: 'Run', keywords: ['run', 'jog', '5k', 'couch to'] },
  { domain: 'move', key: 'stretch', display: 'Stretch & Yoga', keywords: ['stretch', 'yoga', 'mobility', 'pilates'] },
  { domain: 'move', key: 'strength', display: 'Strength', keywords: ['workout', 'gym', 'push up', 'weights', 'strength'] },
  { domain: 'move', key: 'sport', display: 'Sport & Swim', keywords: ['swim', 'bike', 'cycle', 'climb', 'tennis', 'football'] },
  { domain: 'move', key: 'dance', display: 'Dance', keywords: ['dance', 'ballet'] },
  { domain: 'mind', key: 'meditate', display: 'Meditate', keywords: ['meditate', 'meditation', 'sit', 'mindfulness'] },
  { domain: 'mind', key: 'breathe', display: 'Breathwork', keywords: ['breath', 'breathe', 'breathing', 'pranayama'] },
  { domain: 'mind', key: 'journal', display: 'Journal', keywords: ['journal', 'diary', 'morning pages'] },
  { domain: 'mind', key: 'gratitude', display: 'Gratitude', keywords: ['gratitude', 'grateful', 'thankful'] },
  // 'affirmations' (plural) added beyond the spec's example set: the
  // matcher is word-boundary exact, and the plural is how people
  // actually name this practice ("morning affirmations").
  { domain: 'mind', key: 'affirm', display: 'Affirmations', keywords: ['affirmation', 'affirmations', 'affirm', 'mantra', 'self-talk'] },
  { domain: 'learn', key: 'read', display: 'Read', keywords: ['read', 'book', 'pages', 'chapter'] },
  { domain: 'learn', key: 'language', display: 'Language', keywords: ['language', 'spanish', 'french', 'duolingo', 'vocab'] },
  { domain: 'learn', key: 'study', display: 'Study & Courses', keywords: ['study', 'course', 'lecture', 'revise', 'learn'] },
  // music sits AFTER study on purpose: "music theory course" must hit
  // Study & Courses first (spec boundary ruling).
  { domain: 'learn', key: 'music', display: 'Music', keywords: ['guitar', 'piano', 'sing', 'practice scales', 'instrument', 'music'] },
  { domain: 'make', key: 'write', display: 'Write', keywords: ['write', 'writing', 'novel', 'blog', 'poem'] },
  { domain: 'make', key: 'art', display: 'Draw & Paint', keywords: ['draw', 'paint', 'sketch', 'art'] },
  { domain: 'care', key: 'eat', display: 'Eat Well', keywords: ['cook', 'eat', 'vegetables', 'no sugar', 'meal', 'vitamins', 'medicine', 'meds', 'supplements'] },
];

export function typesForDomain(domain: PracticeDomain): PracticeType[] {
  return PRACTICE_TYPES.filter((t) => t.domain === domain);
}

export function getPracticeType(key: string): PracticeType | undefined {
  return PRACTICE_TYPES.find((t) => t.key === key);
}

export function domainDisplay(domain: PracticeDomain): string {
  return PRACTICE_DOMAINS.find((d) => d.key === domain)?.display ?? domain;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Deterministic keyword pre-selection for guided creation. Matching is
 * case-insensitive with word boundaries on both ends of the keyword
 * (multi-word keywords match as literal phrases), so "run" never fires
 * inside "brunch" and "sit" never fires inside "visit". First matching
 * type in table order wins; a name matching nothing returns null and the
 * person picks by hand — never a blocker, never an LLM.
 */
export function classifyPracticeName(
  name: string
): { domain: PracticeDomain; type: PracticeTypeKey } | null {
  const haystack = name.toLowerCase();
  for (const t of PRACTICE_TYPES) {
    for (const keyword of t.keywords) {
      if (new RegExp(`\\b${escapeRegExp(keyword)}\\b`).test(haystack)) {
        return { domain: t.domain, type: t.key };
      }
    }
  }
  return null;
}
