import { MyCircle } from './circle';
import { hasPresenceToday, isEndOfDayComplete } from './dayComplete';

function fakeCircle(overrides: Partial<MyCircle> = {}): MyCircle {
  return {
    id: 'circle-1',
    name: 'Morning Movers',
    timeOfDay: '08:00:00',
    startDate: '2026-06-01',
    durationDays: 21,
    practiceName: 'Walk 20 minutes',
    durationMinutes: 20,
    inviteCode: 'ABC123',
    createdBy: 'user-1',
    resourceUrl: null,
    instructions: null,
    isPublic: false,
    closedToJoins: false,
    ralliedOnAt: null,
    completedAt: null,
    myJoinSource: null,
    ...overrides,
  };
}

const TODAY = '2026-07-22';
const ME = 'me';

describe('hasPresenceToday', () => {
  it('is true for a self row today', () => {
    expect(hasPresenceToday([{ userId: ME, localDate: TODAY }], ME, TODAY)).toBe(true);
  });

  it('is false when the only row is another day', () => {
    expect(hasPresenceToday([{ userId: ME, localDate: '2026-07-21' }], ME, TODAY)).toBe(false);
  });

  it('is false when the only row is another user', () => {
    expect(hasPresenceToday([{ userId: 'other', localDate: TODAY }], ME, TODAY)).toBe(false);
  });

  it('is true for a covered row (getCirclePresence returns the covered member as userId)', () => {
    // A covered day is stored with user_id = the covered member, so it
    // reads exactly like a self row here — Job 9a: covered counts as done.
    expect(hasPresenceToday([{ userId: ME, localDate: TODAY }], ME, TODAY)).toBe(true);
  });
});

describe('isEndOfDayComplete', () => {
  it('short-circuits to done for a single active circle without any presence fetch (Job 9c)', async () => {
    const getCirclePresence = jest.fn(async () => [] as { userId: string; localDate: string }[]);
    const done = await isEndOfDayComplete({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [fakeCircle({ id: 'a' })],
        getCirclePresence,
      },
    });
    expect(done).toBe(true);
    expect(getCirclePresence).not.toHaveBeenCalled();
  });

  it('treats zero active circles as done', async () => {
    const done = await isEndOfDayComplete({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [],
        getCirclePresence: async () => [],
      },
    });
    expect(done).toBe(true);
  });

  it('is done when the user is present in every active circle today', async () => {
    const done = await isEndOfDayComplete({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [fakeCircle({ id: 'a' }), fakeCircle({ id: 'b' })],
        getCirclePresence: async () => [{ userId: ME, localDate: TODAY }],
      },
    });
    expect(done).toBe(true);
  });

  it('is NOT done when one active circle still awaits the user today', async () => {
    const done = await isEndOfDayComplete({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [fakeCircle({ id: 'a' }), fakeCircle({ id: 'b' })],
        getCirclePresence: async (id) =>
          id === 'a' ? [{ userId: ME, localDate: TODAY }] : [],
      },
    });
    expect(done).toBe(false);
  });

  it('counts a covered day as done for the circle it covers', async () => {
    const done = await isEndOfDayComplete({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [fakeCircle({ id: 'a' }), fakeCircle({ id: 'b' })],
        // circle b only has a covered row for me — still counts as done.
        getCirclePresence: async () => [{ userId: ME, localDate: TODAY }],
      },
    });
    expect(done).toBe(true);
  });

  it('excludes completed circles from the awaiting set', async () => {
    // Two circles, but the second is completed (read-only history) and I
    // have no row there today — the day is still done because a completed
    // circle is never awaiting.
    const done = await isEndOfDayComplete({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [
          fakeCircle({ id: 'a' }),
          fakeCircle({ id: 'b', completedAt: '2026-07-20T00:00:00Z' }),
        ],
        getCirclePresence: async () => [{ userId: ME, localDate: TODAY }],
      },
    });
    expect(done).toBe(true);
  });

  it('with two active circles both awaiting, only my presence in both makes it done', async () => {
    const present: Record<string, boolean> = { a: true, b: false };
    const done = await isEndOfDayComplete({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [fakeCircle({ id: 'a' }), fakeCircle({ id: 'b' })],
        getCirclePresence: async (id) =>
          present[id] ? [{ userId: ME, localDate: TODAY }] : [],
      },
    });
    expect(done).toBe(false);
  });
});
