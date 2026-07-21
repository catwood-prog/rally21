/**
 * PB1 — pins timer_suggested's semantics (Cat's timer rule): the flag
 * only says whether setup PRE-SUGGESTS a timer. It never forbids or
 * forces a duration — a "Mark done" practice may still carry one, a
 * timer-suggested practice may carry none. No hard split exists.
 */
import { mapPractice } from './circle-setup';

const baseRow = {
  id: 'practice-1',
  key: 'meditate',
  name: 'Meditate',
  description: null,
  category: 'mind' as const,
  practice_type: 'meditate' as const,
  duration_minutes: null,
  timer_suggested: true,
  created_by: null,
  is_archived: false,
  is_shared: true,
};

describe('mapPractice — timer_suggested (PB1)', () => {
  test('a bank "Optional timer" row: suggested, with NO duration of its own (the dose is chosen at setup)', () => {
    const practice = mapPractice(baseRow);
    expect(practice.timerSuggested).toBe(true);
    expect(practice.durationMinutes).toBeNull();
  });

  test('a bank "Mark done" row: not suggested — but nothing forbids a duration (no hard split)', () => {
    const practice = mapPractice({
      ...baseRow,
      key: 'read-10-pages',
      name: 'Read 10 pages',
      category: 'learn',
      practice_type: 'read',
      timer_suggested: false,
      duration_minutes: 20,
    });
    expect(practice.timerSuggested).toBe(false);
    // The creator chose to read by time anyway — representable exactly
    // as-is; the flag never gates the value.
    expect(practice.durationMinutes).toBe(20);
  });

  test('the reinstated selfcare type maps through (PB1 job 0)', () => {
    const practice = mapPractice({
      ...baseRow,
      key: 'take-time-for-yourself',
      name: 'Take time for yourself',
      category: 'care',
      practice_type: 'selfcare',
    });
    expect(practice.category).toBe('care');
    expect(practice.practiceType).toBe('selfcare');
  });
});
