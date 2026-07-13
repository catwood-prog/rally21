import { isSoloCircle, MyCircle, resolveCircleSelection } from './circle';

function fakeCircle(overrides: Partial<MyCircle> = {}): MyCircle {
  return {
    id: 'circle-1',
    name: 'Morning Movers',
    timeOfDay: '08:00:00',
    startDate: '2026-06-01',
    durationDays: 21,
    practiceName: 'Walk 20 minutes',
    practiceDurationMinutes: 20,
    inviteCode: 'ABC123',
    createdBy: 'user-1',
    resourceUrl: null,
    isPublic: false,
    closedToJoins: false,
    ralliedOnAt: null,
    completedAt: null,
    myJoinSource: null,
    ...overrides,
  };
}

describe('resolveCircleSelection', () => {
  test('branch 1 — explicit circleId fetches that exact circle', async () => {
    const circle = fakeCircle({ id: 'circle-42' });
    const getCircleById = jest.fn().mockResolvedValue(circle);
    const listMyCircles = jest.fn().mockResolvedValue([]);

    const result = await resolveCircleSelection('circle-42', 'user-1', {
      getCircleById,
      listMyCircles,
    });

    expect(getCircleById).toHaveBeenCalledWith('circle-42', 'user-1');
    expect(listMyCircles).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'single', circle });
  });

  test('branch 2 — no circleId, exactly one circle: uses it unambiguously', async () => {
    const circle = fakeCircle();
    const getCircleById = jest.fn();
    const listMyCircles = jest.fn().mockResolvedValue([circle]);

    const result = await resolveCircleSelection(undefined, 'user-1', {
      getCircleById,
      listMyCircles,
    });

    expect(getCircleById).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'single', circle });
  });

  test('branch 2b — no circleId, zero circles: single with a null circle, never crashes', async () => {
    const listMyCircles = jest.fn().mockResolvedValue([]);

    const result = await resolveCircleSelection(undefined, 'user-1', {
      getCircleById: jest.fn(),
      listMyCircles,
    });

    expect(result).toEqual({ kind: 'single', circle: null });
  });

  test('branch 3 — no circleId, more than one circle: asks via a picker, never guesses "the first one"', async () => {
    const circleA = fakeCircle({ id: 'circle-a', name: 'Circle A' });
    const circleB = fakeCircle({ id: 'circle-b', name: 'Circle B' });
    const listMyCircles = jest.fn().mockResolvedValue([circleA, circleB]);

    const result = await resolveCircleSelection(undefined, 'user-1', {
      getCircleById: jest.fn(),
      listMyCircles,
    });

    expect(result).toEqual({ kind: 'picker', circles: [circleA, circleB] });
  });

  test('regression — the literal string "undefined" is treated as an explicit (invalid) id, never as "no circleId"', async () => {
    // router.setParams({ circleId: undefined }) serializes to the literal
    // string "undefined" in the URL, which is truthy — the real bug this
    // guards against was that string being silently re-treated as "no
    // circleId provided" and falling through to the user's circle list,
    // showing whichever circle happened to come back instead of the
    // "not found" state the caller actually needed.
    const getCircleById = jest.fn().mockResolvedValue(null);
    const listMyCircles = jest.fn().mockResolvedValue([fakeCircle()]);

    const result = await resolveCircleSelection('undefined', 'user-1', {
      getCircleById,
      listMyCircles,
    });

    expect(getCircleById).toHaveBeenCalledWith('undefined', 'user-1');
    expect(listMyCircles).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'single', circle: null });
  });
});

describe('isSoloCircle', () => {
  test('exactly one member is solo', () => {
    expect(isSoloCircle(1)).toBe(true);
  });

  test('zero or more than one member is not solo', () => {
    expect(isSoloCircle(0)).toBe(false);
    expect(isSoloCircle(2)).toBe(false);
  });
});
