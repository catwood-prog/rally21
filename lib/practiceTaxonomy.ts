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

export type PracticeDomain = 'move' | 'mind' | 'learn' | 'make' | 'connect' | 'care';

export type PracticeTypeKey =
  | 'walk' | 'run' | 'stretch' | 'strength' | 'sport' | 'dance'
  | 'meditate' | 'breathe' | 'journal' | 'gratitude' | 'unplug'
  | 'read' | 'language' | 'study' | 'listen'
  | 'write' | 'art' | 'music' | 'craft' | 'build'
  | 'reach-out' | 'quality-time' | 'kindness'
  | 'sleep' | 'eat' | 'hydrate' | 'tidy' | 'money' | 'self-care';

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
  { key: 'connect', display: 'Connect' },
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
  { domain: 'move', key: 'stretch', display: 'Stretch & yoga', keywords: ['stretch', 'yoga', 'mobility', 'pilates'] },
  { domain: 'move', key: 'strength', display: 'Strength', keywords: ['workout', 'gym', 'push up', 'weights', 'strength'] },
  { domain: 'move', key: 'sport', display: 'Sport & swim', keywords: ['swim', 'bike', 'cycle', 'climb', 'tennis', 'football'] },
  { domain: 'move', key: 'dance', display: 'Dance', keywords: ['dance', 'ballet'] },
  { domain: 'mind', key: 'meditate', display: 'Meditate', keywords: ['meditate', 'meditation', 'sit', 'mindfulness'] },
  { domain: 'mind', key: 'breathe', display: 'Breathwork', keywords: ['breath', 'breathe', 'breathing', 'pranayama'] },
  { domain: 'mind', key: 'journal', display: 'Journal', keywords: ['journal', 'diary', 'morning pages'] },
  { domain: 'mind', key: 'gratitude', display: 'Gratitude', keywords: ['gratitude', 'grateful', 'thankful'] },
  { domain: 'mind', key: 'unplug', display: 'Unplug', keywords: ['no phone', 'screen free', 'offline', 'detox'] },
  { domain: 'learn', key: 'read', display: 'Read', keywords: ['read', 'book', 'pages', 'chapter'] },
  { domain: 'learn', key: 'language', display: 'Language', keywords: ['language', 'spanish', 'french', 'duolingo', 'vocab'] },
  { domain: 'learn', key: 'study', display: 'Study & courses', keywords: ['study', 'course', 'lecture', 'revise', 'learn'] },
  { domain: 'learn', key: 'listen', display: 'Listen & watch', keywords: ['podcast', 'audiobook', 'documentary'] },
  { domain: 'make', key: 'write', display: 'Write', keywords: ['write', 'writing', 'novel', 'blog', 'poem'] },
  { domain: 'make', key: 'art', display: 'Draw & paint', keywords: ['draw', 'paint', 'sketch', 'art'] },
  { domain: 'make', key: 'music', display: 'Music', keywords: ['guitar', 'piano', 'sing', 'practice scales', 'instrument'] },
  { domain: 'make', key: 'craft', display: 'Craft', keywords: ['knit', 'sew', 'pottery', 'woodwork', 'craft', 'bake'] },
  { domain: 'make', key: 'build', display: 'Build & code', keywords: ['code', 'coding', 'build', 'project', 'app'] },
  { domain: 'connect', key: 'reach-out', display: 'Reach out', keywords: ['call', 'text', 'message', 'check in on', 'friend'] },
  { domain: 'connect', key: 'quality-time', display: 'Quality time', keywords: ['family', 'kids', 'partner', 'date', 'together'] },
  { domain: 'connect', key: 'kindness', display: 'Kindness', keywords: ['kind', 'kindness', 'compliment', 'help someone'] },
  { domain: 'care', key: 'sleep', display: 'Sleep', keywords: ['sleep', 'bed by', 'bedtime', 'wind down', 'screens off'] },
  { domain: 'care', key: 'eat', display: 'Eat well', keywords: ['cook', 'eat', 'vegetables', 'no sugar', 'meal'] },
  { domain: 'care', key: 'hydrate', display: 'Hydrate', keywords: ['water', 'hydrate', 'litres'] },
  { domain: 'care', key: 'tidy', display: 'Tidy', keywords: ['tidy', 'clean', 'declutter', 'make bed'] },
  { domain: 'care', key: 'money', display: 'Money', keywords: ['budget', 'spending', 'money', 'save'] },
  { domain: 'care', key: 'self-care', display: 'Self-care', keywords: ['skincare', 'bath', 'sunscreen', 'floss', 'vitamins'] },
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
