/**
 * PB1 — pins timer_suggested's semantics (Cat's timer rule): the flag
 * only says whether setup PRE-SUGGESTS a timer. It never forbids or
 * forces a duration — a "Mark done" practice may still carry one, a
 * timer-suggested practice may carry none. No hard split exists.
 */
import { createCircleWithDose, mapPractice } from './circle-setup';
import { groupingLine } from './practiceTaxonomy';
import { supabase } from './supabase';

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

// CF2 — the one creation path both setup screens share, pinned at the
// lib boundary: the circle's own dose is written EXPLICITLY after
// create_circle (which only copies the practice's legacy default), and
// clearing the timer really writes null rather than leaving the copy.
describe('createCircleWithDose (CF2)', () => {
  const rpc = supabase.rpc as jest.Mock;
  const from = supabase.from as jest.Mock;

  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  function mockCreate(circleId = 'c-1', inviteCode = 'ABC123') {
    rpc.mockReturnValue({
      single: jest
        .fn()
        .mockResolvedValue({ data: { circle_id: circleId, invite_code: inviteCode }, error: null }),
    });
  }

  test('creates, then writes the chosen dose onto the circle', async () => {
    mockCreate();
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq });
    from.mockReturnValue({ update });

    const result = await createCircleWithDose({
      practiceKey: 'walk',
      timeOfDay: '08:00:00',
      circleName: 'Morning walkers',
      isPublic: false,
      durationMinutes: 15,
      resourceUrl: null,
    });

    expect(result).toEqual({ circleId: 'c-1', inviteCode: 'ABC123' });
    expect(rpc).toHaveBeenCalledWith('create_circle', {
      p_practice_key: 'walk',
      p_time_of_day: '08:00:00',
      p_circle_name: 'Morning walkers',
      p_is_public: false,
    });
    expect(from).toHaveBeenCalledWith('circles');
    expect(update).toHaveBeenCalledWith({ duration_minutes: 15 });
    expect(eq).toHaveBeenCalledWith('id', 'c-1');
  });

  test('writes null when no timer was chosen — "no dose" beats the legacy copy', async () => {
    mockCreate('c-2');
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq });
    from.mockReturnValue({ update });

    await createCircleWithDose({
      practiceKey: 'meditate',
      timeOfDay: '18:00:00',
      circleName: 'Evening sit',
      isPublic: true,
      durationMinutes: null,
      resourceUrl: null,
    });

    expect(update).toHaveBeenCalledWith({ duration_minutes: null });
  });

  test('a failed dose write never sinks the circle that already exists', async () => {
    mockCreate('c-3', 'ZZZ999');
    const eq = jest.fn().mockRejectedValue(new Error('network died'));
    from.mockReturnValue({ update: jest.fn().mockReturnValue({ eq }) });

    await expect(
      createCircleWithDose({
        practiceKey: 'read',
        timeOfDay: '21:00:00',
        circleName: 'Night readers',
        isPublic: false,
        durationMinutes: 20,
        resourceUrl: null,
      })
    ).resolves.toEqual({ circleId: 'c-3', inviteCode: 'ZZZ999' });
  });
});

// CF2 — the "Learn · Read" grouping line every flow surface shares.
describe('groupingLine (CF2)', () => {
  test('renders Domain · Type across domains', () => {
    expect(groupingLine('read')).toBe('Learn · Read');
    expect(groupingLine('walk')).toBe('Move · Walk');
    expect(groupingLine('selfcare')).toBe('Care · Self-Care');
  });

  test('returns null for an unknown key so callers omit the line, never print a raw key', () => {
    expect(groupingLine('banana')).toBeNull();
  });
});
