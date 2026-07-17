/**
 * PT1 — pins the taxonomy tables and the deterministic classifier,
 * including every boundary ruling written into
 * Rally21-Practice-Taxonomy-Spec.md so future keyword additions can't
 * silently re-litigate them.
 */
import {
  classifyPracticeName,
  PRACTICE_DOMAINS,
  PRACTICE_TYPES,
  typesForDomain,
} from './practiceTaxonomy';

describe('the type table', () => {
  it('has exactly the six domains and 29 permanent type keys', () => {
    expect(PRACTICE_DOMAINS.map((d) => d.key)).toEqual([
      'move', 'mind', 'learn', 'make', 'connect', 'care',
    ]);
    expect(PRACTICE_TYPES).toHaveLength(29);
    // Keys are permanent API — this list is the spec's, verbatim. If this
    // test is failing you are renaming/removing a shipped key: don't.
    expect(PRACTICE_TYPES.map((t) => t.key)).toEqual([
      'walk', 'run', 'stretch', 'strength', 'sport', 'dance',
      'meditate', 'breathe', 'journal', 'gratitude', 'unplug',
      'read', 'language', 'study', 'listen',
      'write', 'art', 'music', 'craft', 'build',
      'reach-out', 'quality-time', 'kindness',
      'sleep', 'eat', 'hydrate', 'tidy', 'money', 'self-care',
    ]);
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
  it('classifies the PT1 acceptance examples', () => {
    expect(classifyPracticeName('Read 10 pages before bed')).toEqual({ domain: 'learn', type: 'read' });
    expect(classifyPracticeName('call mum')).toEqual({ domain: 'connect', type: 'reach-out' });
    expect(classifyPracticeName('zzxqv flurble')).toBeNull();
  });

  it('holds the spec boundary rulings', () => {
    // "Read before bed" is reading, not a bedtime routine.
    expect(classifyPracticeName('Read before bed')).toEqual({ domain: 'learn', type: 'read' });
    // A screens-off bedtime routine IS care/sleep.
    expect(classifyPracticeName('Screens off by 10')).toEqual({ domain: 'care', type: 'sleep' });
    expect(classifyPracticeName('In bed by 10:30')).toEqual({ domain: 'care', type: 'sleep' });
    // Creative cooking/baking → make/craft; eating habits → care/eat.
    expect(classifyPracticeName('Bake sourdough')).toEqual({ domain: 'make', type: 'craft' });
    expect(classifyPracticeName('Eat more vegetables')).toEqual({ domain: 'care', type: 'eat' });
    // Playing an instrument → make/music; music theory course → learn/study.
    expect(classifyPracticeName('Practice guitar 15 minutes')).toEqual({ domain: 'make', type: 'music' });
    expect(classifyPracticeName('Music theory course')).toEqual({ domain: 'learn', type: 'study' });
  });

  it('matches whole words and phrases, never substrings', () => {
    // "run" must not fire inside "brunch"; "sit" not inside "visit".
    expect(classifyPracticeName('Sunday brunch prep')).toBeNull();
    expect(classifyPracticeName('Visit the market')).toBeNull();
    expect(classifyPracticeName('Sit quietly for 5 minutes')).toEqual({ domain: 'mind', type: 'meditate' });
    // Multi-word keywords match as phrases.
    expect(classifyPracticeName('Couch to 5k plan')).toEqual({ domain: 'move', type: 'run' });
    expect(classifyPracticeName('No phone after dinner')).toEqual({ domain: 'mind', type: 'unplug' });
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

  it('classifies the live cohort names the way the migration backfilled them', () => {
    expect(classifyPracticeName('Stretching/Yoga moves')).toEqual({ domain: 'move', type: 'stretch' });
    expect(classifyPracticeName('Workout - no equipment needed')).toEqual({ domain: 'move', type: 'strength' });
    expect(classifyPracticeName('Breath of Fire & Fists of Anger')).toEqual({ domain: 'mind', type: 'breathe' });
    expect(classifyPracticeName('Meditate 5 minutes')).toEqual({ domain: 'mind', type: 'meditate' });
  });
});
