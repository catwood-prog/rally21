/**
 * PT1/PT3 — pins the taxonomy tables and the deterministic classifier,
 * including every boundary ruling written into
 * Rally21-Practice-Taxonomy-Spec.md so future keyword additions can't
 * silently re-litigate them. PT3 (17 July) re-cut the table to Cat's
 * 18-key / five-domain ruling: names that used to match a retired type
 * (call mum, no phone, bake, bed by ten…) now get NO pre-selection —
 * the warm manual pick handles them, never an error.
 */
import {
  classifyPracticeName,
  PRACTICE_DOMAINS,
  PRACTICE_TYPES,
  typesForDomain,
} from './practiceTaxonomy';

describe('the type table', () => {
  it('has exactly the five domains and 19 permanent type keys (PT3 re-cut + PB1 selfcare)', () => {
    expect(PRACTICE_DOMAINS.map((d) => d.key)).toEqual([
      'move', 'mind', 'learn', 'make', 'care',
    ]);
    expect(PRACTICE_TYPES).toHaveLength(19);
    // Keys are permanent API — the spec's 16 July table plus selfcare,
    // REINSTATED by Cat's 21 July evening ruling (PB1; a conscious
    // partial reversal of the prune). The other retired keys stay
    // retired; don't rename/remove/re-add without a migration + ruling.
    expect(PRACTICE_TYPES.map((t) => t.key)).toEqual([
      'walk', 'run', 'stretch', 'strength', 'sport', 'dance',
      'meditate', 'breathe', 'journal', 'gratitude', 'affirm',
      'read', 'language', 'study', 'music',
      'write', 'art',
      'eat', 'selfcare',
    ]);
  });

  it('music lives in learn (PT3: moved from make, display stays Music)', () => {
    const music = PRACTICE_TYPES.find((t) => t.key === 'music');
    expect(music?.domain).toBe('learn');
    expect(music?.display).toBe('Music');
  });

  it('display names are Title Case on every word (Cat, 17 July)', () => {
    for (const t of PRACTICE_TYPES) {
      for (const word of t.display.split(/[\s&]+/).filter(Boolean)) {
        expect(word[0]).toBe(word[0].toUpperCase());
      }
    }
  });

  it('every type belongs to a real domain and keys are unique', () => {
    const domains = new Set(PRACTICE_DOMAINS.map((d) => d.key));
    const keys = new Set<string>();
    for (const t of PRACTICE_TYPES) {
      expect(domains.has(t.domain)).toBe(true);
      expect(keys.has(t.key)).toBe(false);
      keys.add(t.key);
      expect(t.keywords.length).toBeGreaterThan(0);
    }
  });

  it('typesForDomain partitions the table', () => {
    const total = PRACTICE_DOMAINS.reduce((n, d) => n + typesForDomain(d.key).length, 0);
    expect(total).toBe(PRACTICE_TYPES.length);
  });
});

describe('classifyPracticeName', () => {
  it('classifies the acceptance examples', () => {
    expect(classifyPracticeName('Read 10 pages before bed')).toEqual({ domain: 'learn', type: 'read' });
    expect(classifyPracticeName('take my vitamins')).toEqual({ domain: 'care', type: 'eat' });
    expect(classifyPracticeName('zzxqv flurble')).toBeNull();
  });

  it('gives retired-type names NO pre-selection (PT3 — manual pick, never an error)', () => {
    // These all matched a type before the 17 July re-cut; the retired
    // keywords went with their types, so they now fall to the warm
    // manual pick.
    expect(classifyPracticeName('call mum')).toBeNull(); // was connect/reach-out
    expect(classifyPracticeName('No phone after dinner')).toBeNull(); // was mind/unplug
    expect(classifyPracticeName('Bake sourdough')).toBeNull(); // was make/craft
    expect(classifyPracticeName('In bed by 10:30')).toBeNull(); // was care/sleep
    expect(classifyPracticeName('budget check')).toBeNull(); // was care/money
    expect(classifyPracticeName('drink two litres of water')).toBeNull(); // was care/hydrate
  });

  it('classifies the reinstated selfcare type (PB1 — Cat\'s ruled keywords)', () => {
    expect(classifyPracticeName('Give yourself a massage')).toEqual({ domain: 'care', type: 'selfcare' });
    expect(classifyPracticeName('lymphatic drainage self-massage')).toEqual({ domain: 'care', type: 'selfcare' });
    expect(classifyPracticeName('30 minutes of me time')).toEqual({ domain: 'care', type: 'selfcare' });
    expect(classifyPracticeName('daily self-care hour')).toEqual({ domain: 'care', type: 'selfcare' });
    // The bank's own "Take time for yourself" carries none of the ruled
    // keywords — the warm manual pick handles it, never an error.
    expect(classifyPracticeName('Take time for yourself')).toBeNull();
  });

  it('classifies the new affirm type', () => {
    expect(classifyPracticeName('morning affirmations')).toEqual({ domain: 'mind', type: 'affirm' });
    expect(classifyPracticeName('say my mantra')).toEqual({ domain: 'mind', type: 'affirm' });
    expect(classifyPracticeName('practice positive self-talk')).toEqual({ domain: 'mind', type: 'affirm' });
  });

  it('holds the spec boundary rulings that survive the re-cut', () => {
    // "Read before bed" is reading, not a bedtime routine.
    expect(classifyPracticeName('Read before bed')).toEqual({ domain: 'learn', type: 'read' });
    // Eating habits → care/eat — now including the vitamins/meds set
    // that moved over from retired self-care.
    expect(classifyPracticeName('Eat more vegetables')).toEqual({ domain: 'care', type: 'eat' });
    expect(classifyPracticeName('remember my meds')).toEqual({ domain: 'care', type: 'eat' });
    // Playing an instrument → music (now learn); music theory course →
    // learn/study (study sits before music in the table on purpose).
    expect(classifyPracticeName('Practice guitar 15 minutes')).toEqual({ domain: 'learn', type: 'music' });
    expect(classifyPracticeName('Music theory course')).toEqual({ domain: 'learn', type: 'study' });
  });

  it('matches whole words and phrases, never substrings', () => {
    // "run" must not fire inside "brunch"; "sit" not inside "visit".
    expect(classifyPracticeName('Sunday brunch prep')).toBeNull();
    expect(classifyPracticeName('Visit the market')).toBeNull();
    expect(classifyPracticeName('Sit quietly for 5 minutes')).toEqual({ domain: 'mind', type: 'meditate' });
    // Multi-word keywords match as phrases.
    expect(classifyPracticeName('Couch to 5k plan')).toEqual({ domain: 'move', type: 'run' });
    expect(classifyPracticeName('Morning pages')).toEqual({ domain: 'mind', type: 'journal' });
    // "pages" alone (without the phrase) is learn/read.
    expect(classifyPracticeName('Ten pages a day')).toEqual({ domain: 'learn', type: 'read' });
  });

  it('is case-insensitive and deterministic', () => {
    expect(classifyPracticeName('MEDITATE 10 MINUTES')).toEqual({ domain: 'mind', type: 'meditate' });
    const a = classifyPracticeName('Walk 20 minutes');
    const b = classifyPracticeName('Walk 20 minutes');
    expect(a).toEqual({ domain: 'move', type: 'walk' });
    expect(b).toEqual(a);
  });

  it('classifies the live cohort names the way the migrations filed them', () => {
    expect(classifyPracticeName('Stretching/Yoga moves')).toEqual({ domain: 'move', type: 'stretch' });
    expect(classifyPracticeName('Workout - no equipment needed')).toEqual({ domain: 'move', type: 'strength' });
    expect(classifyPracticeName('Breath of Fire & Fists of Anger')).toEqual({ domain: 'mind', type: 'breathe' });
    expect(classifyPracticeName('Meditate 5 minutes')).toEqual({ domain: 'mind', type: 'meditate' });
  });
});
