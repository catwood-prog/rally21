import { deriveCheckinAccent } from './practice-accent';

// C1 (7 July): "close your {accent}" must read as natural English for
// every verb in PRACTICE_VERB_STARTERS — meditate -> "sit" used to yield
// "close your sit", which is exactly as broken as the bug this fixes.
// One case per verb, in its simplest "verb + quantity + time unit" shape
// (the shape that exercises the verb-only accent path), plus the real
// currently-seeded and real custom practice names live in the DB today.

describe('deriveCheckinAccent — every verb in PRACTICE_VERB_STARTERS reads naturally', () => {
  it('meditate -> meditation ("close your meditation")', () => {
    expect(deriveCheckinAccent('Meditate 10 minutes')).toBe('meditation');
  });

  it('walk -> walk, unchanged ("close your walk")', () => {
    expect(deriveCheckinAccent('Walk 20 minutes')).toBe('walk');
  });

  it('run -> run, unchanged ("close your run")', () => {
    expect(deriveCheckinAccent('Run 30 minutes')).toBe('run');
  });

  it('write -> writing ("close your writing"), not the bare verb', () => {
    expect(deriveCheckinAccent('Write 10 minutes')).toBe('writing');
  });

  it('stretch -> stretch, unchanged ("close your stretch")', () => {
    expect(deriveCheckinAccent('Stretch 10 minutes')).toBe('stretch');
  });

  it('sit -> sitting ("close your sitting"), not "close your sit"', () => {
    expect(deriveCheckinAccent('Sit 10 minutes')).toBe('sitting');
  });

  it('breathe -> breathing ("close your breathing")', () => {
    expect(deriveCheckinAccent('Breathe 5 minutes')).toBe('breathing');
  });

  it('read -> read, unchanged ("close your read")', () => {
    expect(deriveCheckinAccent('Read 20 minutes')).toBe('read');
  });

  it('journal -> journal, unchanged ("close your journal")', () => {
    expect(deriveCheckinAccent('Journal 10 minutes')).toBe('journal');
  });

  it('draw -> draw, unchanged ("close your draw")', () => {
    expect(deriveCheckinAccent('Draw 15 minutes')).toBe('draw');
  });

  it('move -> movement ("close your movement")', () => {
    expect(deriveCheckinAccent('Move 20 minutes')).toBe('movement');
  });

  it('practice -> practice, unchanged ("close your practice")', () => {
    expect(deriveCheckinAccent('Practice 10 minutes')).toBe('practice');
  });

  it('do -> practice (has no natural noun form of its own)', () => {
    expect(deriveCheckinAccent('Do 10 minutes')).toBe('practice');
  });
});

describe('deriveCheckinAccent — the pluralize-object path', () => {
  it('prefers "writing" over the derived object for write, which reads oddly ("close your pages")', () => {
    expect(deriveCheckinAccent('Write one page')).toBe('writing');
  });

  it('still derives a pluralized object noun for other verbs with a real object', () => {
    expect(deriveCheckinAccent('Read one chapter')).toBe('chapters');
  });
});

describe('deriveCheckinAccent — real practices currently live in the DB', () => {
  it('the three seeded meditation practices all read naturally', () => {
    expect(deriveCheckinAccent('Meditate 5 minutes')).toBe('meditation');
    expect(deriveCheckinAccent('Meditate 10 minutes')).toBe('meditation');
    expect(deriveCheckinAccent('Meditate 15 minutes')).toBe('meditation');
  });

  it('real custom practice names that do not start with a recognized verb fall back to "practice"', () => {
    expect(deriveCheckinAccent('Stretching/Yoga moves')).toBe('practice');
    expect(deriveCheckinAccent('Workout - no equipment needed')).toBe('practice');
    expect(deriveCheckinAccent('Breath of Fire & Fists of Anger')).toBe('practice');
  });
});

describe('deriveCheckinAccent — resilient fallback', () => {
  it('falls back to "practice" for null/undefined', () => {
    expect(deriveCheckinAccent(null)).toBe('practice');
    expect(deriveCheckinAccent(undefined)).toBe('practice');
  });

  it('falls back to "practice" for an empty string', () => {
    expect(deriveCheckinAccent('')).toBe('practice');
  });
});
