import * as fs from 'fs';
import * as path from 'path';

import { ShareCard } from './shareCards';
import {
  buildShareCardNavParams,
  dotStripLine,
  fillJourneyTemplate,
  journeyWeekNumber,
  numberWord,
} from './shareCardTemplates';

// SC2 — the journey template bank lives in the seed migration (the DB is
// the founder-editable source of truth, like the quote bank). Rather than
// keep a driftable client mirror just for tests, the audits below read
// the ACTUAL migration file, so a body edit is audited the moment it's
// made. (The insert is one row per line, so a line regex is reliable.)
const MIGRATION_PATH = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260718110000_sc2_journey_dot_strip_flavors.sql'
);

type SeededTemplate = { id: string; body: string; needsCount: boolean; moment: string };

function readSeededTemplates(): SeededTemplate[] {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const rows: SeededTemplate[] = [];
  for (const line of sql.split('\n')) {
    const m = line.match(/^\s*\('(WJ-\d+)',\s*'warm_journey',\s*E?'([^']*)',/);
    if (!m) continue;
    const moment = line.match(/'\{[^}]*\}',\s*'(any|early|arc|covered)',/);
    rows.push({
      id: m[1],
      body: m[2],
      needsCount: line.includes("'{needs_count}'"),
      moment: moment ? moment[1] : 'unknown',
    });
  }
  return rows;
}

describe('the seeded journey template bank (migration audit)', () => {
  const templates = readSeededTemplates();

  it('finds the whole bank in the migration (regex is not silently matching nothing)', () => {
    expect(templates.length).toBeGreaterThanOrEqual(10);
    expect(templates.map((t) => t.id)).toContain('WJ-01');
  });

  it('no template can reference a miss — warmth law, audited by construction over the full bank', () => {
    const forbidden = /\b(miss|missed|missing|misses|broke|broken|streak|behind|lost|lose|fail|failed|quit|skipped)\b/i;
    for (const t of templates) {
      expect(`${t.id}: ${t.body}`).not.toMatch(forbidden);
    }
  });

  it('carries the spec §4.2 covered-day line, gated to covered days', () => {
    const covered = templates.filter((t) => t.moment === 'covered');
    expect(covered).toHaveLength(1);
    expect(covered[0].body).toBe('A friend held your place today. That’s the whole idea.');
  });

  it('uses only slots the client fill supports', () => {
    for (const t of templates) {
      const slots = t.body.match(/\{[a-zA-Z]+\}/g) ?? [];
      for (const slot of slots) {
        expect(['{day}', '{count}', '{countWord}', '{practiceNoun}']).toContain(slot);
      }
    }
  });

  it('tags every count-slot template needs_count (so the server never serves it count-less)', () => {
    for (const t of templates) {
      const usesCount = t.body.includes('{count}') || t.body.includes('{countWord}');
      if (usesCount) expect(`${t.id} needs_count`).toBe(t.needsCount ? `${t.id} needs_count` : `${t.id} MISSING`);
    }
  });

  it('every template fills cleanly with realistic slots — no braces survive', () => {
    for (const t of templates) {
      const filled = fillJourneyTemplate(t.body, { day: 12, timesShown: 12, practiceNoun: 'meditation' });
      expect(filled).not.toBeNull();
      expect(filled!).not.toMatch(/\{|\}/);
    }
  });
});

describe('numberWord', () => {
  it('words the small numbers cards actually show', () => {
    expect(numberWord(1)).toBe('one');
    expect(numberWord(3)).toBe('three');
    expect(numberWord(12)).toBe('twelve');
    expect(numberWord(20)).toBe('twenty');
  });

  it('falls back to digits past twenty', () => {
    expect(numberWord(21)).toBe('21');
    expect(numberWord(100)).toBe('100');
  });
});

describe('fillJourneyTemplate', () => {
  it('fills the flagship count template', () => {
    expect(
      fillJourneyTemplate('You’ve kept a promise to yourself {countWord} times.', {
        day: 12,
        timesShown: 12,
        practiceNoun: 'meditation',
      })
    ).toBe('You’ve kept a promise to yourself twelve times.');
  });

  it('fills day and practice-noun slots', () => {
    expect(
      fillJourneyTemplate('Day {day}: your {practiceNoun}.', { day: 9, timesShown: null, practiceNoun: 'pages' })
    ).toBe('Day 9: your pages.');
  });

  it('returns null rather than ever rendering raw braces (count missing)', () => {
    expect(
      fillJourneyTemplate('{countWord} times.', { day: 5, timesShown: null, practiceNoun: 'practice' })
    ).toBeNull();
    expect(fillJourneyTemplate('{countWord} times.', { day: 5, timesShown: 1, practiceNoun: 'practice' })).toBeNull();
  });

  it('returns null on an unknown slot', () => {
    expect(fillJourneyTemplate('Hello {mystery}.', { day: 5, timesShown: 5, practiceNoun: 'practice' })).toBeNull();
  });
});

describe('journeyWeekNumber', () => {
  it('maps journey days onto weeks', () => {
    expect(journeyWeekNumber(1)).toBe(1);
    expect(journeyWeekNumber(7)).toBe(1);
    expect(journeyWeekNumber(8)).toBe(2);
    expect(journeyWeekNumber(15)).toBe(3);
    expect(journeyWeekNumber(21)).toBe(3);
  });
});

describe('dotStripLine', () => {
  it('names the practice by default, quoted so any stored name stays grammatical', () => {
    expect(dotStripLine(3, 'Morning pages')).toBe('week three of “Morning pages”');
    expect(dotStripLine(2, 'Meditate 10 minutes')).toBe('week two of “Meditate 10 minutes”');
  });

  it('renders the generic form when the name is withheld', () => {
    expect(dotStripLine(3, null)).toBe('week three of your daily practice');
  });

  it('falls to digits for a long-arc week', () => {
    expect(dotStripLine(30, null)).toBe('week 30 of your daily practice');
  });
});

describe('buildShareCardNavParams', () => {
  const week = [
    { date: '2026-07-12', state: 'earned' as const },
    { date: '2026-07-13', state: 'held' as const },
    { date: '2026-07-14', state: 'none' as const },
  ];

  const quote: ShareCard = {
    flavor: 'curated_quote',
    cardKey: 'QB-001',
    body: 'The quote.',
    attribution: 'Seneca',
    gloss: null,
  };

  it('passes a quote card through untouched', () => {
    expect(buildShareCardNavParams(quote, { week, dayNumber: 5, timesShown: 4, practiceName: 'Run 5k' })).toEqual({
      flavor: 'curated_quote',
      cardKey: 'QB-001',
      body: 'The quote.',
      attribution: 'Seneca',
      gloss: '',
    });
  });

  it('fills a journey template and carries the day header', () => {
    const card: ShareCard = {
      flavor: 'warm_journey',
      cardKey: 'WJ-01',
      body: 'You’ve kept a promise to yourself {countWord} times.',
      attribution: null,
      gloss: null,
    };
    expect(buildShareCardNavParams(card, { week, dayNumber: 12, timesShown: 11, practiceName: null })).toEqual({
      flavor: 'warm_journey',
      cardKey: 'WJ-01',
      body: 'You’ve kept a promise to yourself eleven times.',
      dayNumber: '12',
    });
  });

  it('returns null (no card) when a journey fill cannot complete', () => {
    const card: ShareCard = {
      flavor: 'warm_journey',
      cardKey: 'WJ-01',
      body: '{countWord} times.',
      attribution: null,
      gloss: null,
    };
    expect(buildShareCardNavParams(card, { week, dayNumber: 12, timesShown: null, practiceName: null })).toBeNull();
  });

  it('rides the dot strip as data: week JSON + week number + the practice name', () => {
    const card: ShareCard = { flavor: 'dot_strip', cardKey: 'DS-2026-29', body: '', attribution: null, gloss: null };
    const params = buildShareCardNavParams(card, {
      week,
      dayNumber: 16,
      timesShown: null,
      practiceName: 'Morning pages',
    });
    expect(params).toEqual({
      flavor: 'dot_strip',
      cardKey: 'DS-2026-29',
      week: JSON.stringify(week),
      weekNumber: '3',
      practiceName: 'Morning pages',
    });
    expect(JSON.parse(params!.week)).toEqual(week);
  });

  it('returns null for a dot strip with no week data', () => {
    const card: ShareCard = { flavor: 'dot_strip', cardKey: 'DS-2026-29', body: '', attribution: null, gloss: null };
    expect(buildShareCardNavParams(card, { week: [], dayNumber: 16, timesShown: null, practiceName: null })).toBeNull();
  });
});
