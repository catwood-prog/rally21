import { BlueprintPattern } from './blueprint';
import { assembleManual, buildEntries, buildObservations, formatManualExport } from './manual';

const pattern = (over: Partial<BlueprintPattern>): BlueprintPattern => ({
  patternKey: 'k',
  patternType: 'consistency',
  weekday: null,
  direction: null,
  cutoffHour: 9,
  agreementCount: 8,
  totalCount: 10,
  evidenceRate: 0.8,
  statement: null,
  ...over,
});

const row = (over: Partial<Parameters<typeof buildEntries>[0][number]> = {}) => ({
  local_date: '2026-07-12',
  question_answer: 'a walk, no phone',
  question_prompt_snapshot: null,
  questions: {
    code: 'STR-03',
    prompt: 'What reliably helps you *recharge* in 20 minutes or less?',
    manual_section: 'overwhelm-restore',
    why_we_ask: 'Short, reliable ways to recharge are especially useful.',
  },
  ...over,
});

describe('buildEntries', () => {
  it('takes the latest answer as current and files older ones behind it', () => {
    // Rows arrive newest-first, the order getMyManual asks the server for.
    const sections = buildEntries([
      row({ local_date: '2026-07-12', question_answer: 'a walk, no phone' }),
      row({ local_date: '2026-07-05', question_answer: 'lying on the floor' }),
      row({ local_date: '2026-06-28', question_answer: 'tea' }),
    ]);

    const entries = sections.get('overwhelm-restore')!;
    expect(entries).toHaveLength(1);
    expect(entries[0].answer).toBe('a walk, no phone');
    expect(entries[0].localDate).toBe('2026-07-12');
    expect(entries[0].earlier.map((e) => e.answer)).toEqual(['lying on the floor', 'tea']);
  });

  it('strips the accent markers from the question, since this renders as plain text', () => {
    const entries = buildEntries([row()]).get('overwhelm-restore')!;
    expect(entries[0].question).toBe('What reliably helps you recharge in 20 minutes or less?');
    expect(entries[0].question).not.toContain('*');
  });

  it('prefers the snapshot over the bank wording, so the page never retells history', () => {
    const entries = buildEntries([
      row({ question_prompt_snapshot: 'What reliably *restores* you in under 20 minutes?' }),
    ]).get('overwhelm-restore')!;
    expect(entries[0].question).toBe('What reliably restores you in under 20 minutes?');
  });

  it('drops rows with no answer, no code, or a section outside the v1 four', () => {
    const sections = buildEntries([
      row({ question_answer: null }),
      row({ question_answer: '   ' }),
      row({ questions: { ...row().questions!, code: null } }),
      row({ questions: { ...row().questions!, manual_section: null } }),
      row({ questions: { ...row().questions!, manual_section: 'not-a-section' } }),
    ]);
    expect(sections.size).toBe(0);
  });
});

describe('buildObservations', () => {
  it('files the two timing patterns under energy and recovery', () => {
    const sections = buildObservations([
      pattern({ patternKey: 'c', patternType: 'consistency' }),
      pattern({ patternKey: 't', patternType: 'time_of_day_mood', direction: 'before_noon_higher' }),
    ]);
    expect(sections.get('energy-recovery')).toHaveLength(2);
  });

  it('files a weekday mood dip under when things get heavy', () => {
    const sections = buildObservations([
      pattern({ patternKey: 'w', patternType: 'weekday_mood', weekday: 1, direction: 'low' }),
    ]);
    expect(sections.get('overwhelm-restore')).toHaveLength(1);
  });

  it('never files synthesis patterns anywhere — placing them would BE the synthesis v1 excludes', () => {
    const sections = buildObservations([
      pattern({ patternKey: 's', patternType: 'synthesis_pattern', statement: 'You seem to like mornings.' }),
      pattern({ patternKey: 'w2', patternType: 'synthesis_want', statement: 'You want to run more.' }),
    ]);
    expect(sections.size).toBe(0);
  });

  it('leaves connection and misread with no observed lane at all, since no detector observes them', () => {
    const sections = buildObservations([
      pattern({ patternType: 'consistency' }),
      pattern({ patternKey: 'w', patternType: 'weekday_mood', weekday: 1, direction: 'low' }),
    ]);
    expect(sections.has('connection')).toBe(false);
    expect(sections.has('misread')).toBe(false);
  });
});

describe('assembleManual', () => {
  it('renders only sections that exist in data', () => {
    const manual = assembleManual([row()], []);
    expect(manual.sections.map((s) => s.key)).toEqual(['overwhelm-restore']);
    expect(manual.isEmpty).toBe(false);
  });

  it('is empty when the person has said nothing and nothing has been observed', () => {
    expect(assembleManual([], []).isEmpty).toBe(true);
  });

  it('keeps section reading order regardless of the order data arrives in', () => {
    const manual = assembleManual(
      [row({ questions: { ...row().questions!, code: 'CON-07', manual_section: 'connection' } }), row()],
      [pattern({ patternType: 'consistency' })]
    );
    expect(manual.sections.map((s) => s.key)).toEqual([
      'energy-recovery',
      'connection',
      'overwhelm-restore',
    ]);
  });

  it('a section can hold one lane without the other', () => {
    const manual = assembleManual([], [pattern({ patternType: 'consistency' })]);
    expect(manual.sections).toHaveLength(1);
    expect(manual.sections[0].entries).toHaveLength(0);
    expect(manual.sections[0].observations).toHaveLength(1);
  });
});

describe('formatManualExport', () => {
  const stableDate = (d: string) => d;

  it('keeps the two lanes labelled and separate on the way out', () => {
    const manual = assembleManual([row()], [
      pattern({ patternKey: 'w', patternType: 'weekday_mood', weekday: 1, direction: 'low' }),
    ]);
    const text = formatManualExport(manual, stableDate);

    expect(text).toContain('how you work');
    expect(text).toContain('WHEN THINGS GET HEAVY');
    expect(text).toContain('in your words');
    expect(text).toContain("what we've seen");
    expect(text.indexOf('in your words')).toBeLessThan(text.indexOf("what we've seen"));
    expect(text).toContain('"a walk, no phone" (2026-07-12)');
    expect(text.endsWith('— exported from Rally21')).toBe(true);
  });

  it('omits a lane rather than printing a header over nothing', () => {
    const text = formatManualExport(assembleManual([row()], []), stableDate);
    expect(text).toContain('in your words');
    expect(text).not.toContain("what we've seen");
  });

  it('carries earlier answers too, so the download is the whole record', () => {
    const manual = assembleManual(
      [row(), row({ local_date: '2026-07-05', question_answer: 'lying on the floor' })],
      []
    );
    const text = formatManualExport(manual, stableDate);
    expect(text).toContain('"lying on the floor" (2026-07-05)');
  });

  it('an empty manual still exports as a titled, footered file rather than a blank one', () => {
    const text = formatManualExport({ sections: [], isEmpty: true }, stableDate);
    expect(text).toBe('how you work\n\n— exported from Rally21');
  });
});
