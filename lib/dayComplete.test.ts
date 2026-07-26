import { MyCircle } from './circle';
import { STRINGS } from '@/constants/strings';

import { getDayCloseState, hasPresenceToday, isEndOfDayComplete } from './dayComplete';

function fakeCircle(overrides: Partial<MyCircle> = {}): MyCircle {
  return {
    id: 'circle-1',
    name: 'Morning Movers',
    timeOfDay: '08:00:00',
    startDate: '2026-06-01',
    durationDays: 21,
    practiceName: 'Walk 20 minutes',
    practiceIsUserCreated: false,
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

// OD1 job 9d (Cat's ruling, 26 July) — the closing beat says the count
// out loud ("two more today"), so the count has to be as trustworthy as
// the gate. It comes from the SAME traversal, which is what stops the
// number and the gate ever disagreeing.
describe('getDayCloseState — the count behind the closing beat', () => {
  it('one active circle: done, nothing awaiting, and no presence fetch at all', async () => {
    const getCirclePresence = jest.fn();
    const state = await getDayCloseState({
      userId: ME,
      localDate: TODAY,
      deps: { listMyCircles: async () => [fakeCircle({ id: 'a' })], getCirclePresence },
    });
    expect(state).toEqual({ isComplete: true, awaitingCount: 0 });
    // Job 9c's proof, restated for the count: single-circle users cost
    // nothing extra and cannot reach the count-aware label.
    expect(getCirclePresence).not.toHaveBeenCalled();
  });

  it('counts only the circles still awaiting, not the ones already done', async () => {
    const present: Record<string, boolean> = { a: true, b: false, c: false };
    const state = await getDayCloseState({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [
          fakeCircle({ id: 'a' }),
          fakeCircle({ id: 'b' }),
          fakeCircle({ id: 'c' }),
        ],
        getCirclePresence: async (id) => (present[id] ? [{ userId: ME, localDate: TODAY }] : []),
      },
    });
    expect(state).toEqual({ isComplete: false, awaitingCount: 2 });
  });

  it('a COMPLETED circle is never awaiting, so it never inflates the count', async () => {
    const state = await getDayCloseState({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [
          fakeCircle({ id: 'a' }),
          fakeCircle({ id: 'b' }),
          fakeCircle({ id: 'archived', completedAt: '2026-07-20T00:00:00Z' }),
        ],
        getCirclePresence: async (id) => (id === 'a' ? [{ userId: ME, localDate: TODAY }] : []),
      },
    });
    expect(state.awaitingCount).toBe(1);
  });

  it('a COVERED day counts as done, so a covered circle is not awaiting', async () => {
    const state = await getDayCloseState({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [fakeCircle({ id: 'a' }), fakeCircle({ id: 'b' })],
        // getCirclePresence returns the covered member's OWN row, which
        // is why a gift reads as done here exactly as it does on Today.
        getCirclePresence: async () => [{ userId: ME, localDate: TODAY }],
      },
    });
    expect(state).toEqual({ isComplete: true, awaitingCount: 0 });
  });

  it('awaitingCount is 0 whenever the day is complete — they can never disagree', async () => {
    const state = await getDayCloseState({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [fakeCircle({ id: 'a' }), fakeCircle({ id: 'b' })],
        getCirclePresence: async () => [{ userId: ME, localDate: TODAY }],
      },
    });
    expect(state.isComplete).toBe(true);
    expect(state.awaitingCount).toBe(0);
  });

  it('isEndOfDayComplete still answers exactly as before (same source, one definition)', async () => {
    const deps = {
      listMyCircles: async () => [fakeCircle({ id: 'a' }), fakeCircle({ id: 'b' })],
      getCirclePresence: async (id: string) =>
        id === 'a' ? [{ userId: ME, localDate: TODAY }] : [],
    };
    const [legacy, state] = await Promise.all([
      isEndOfDayComplete({ userId: ME, localDate: TODAY, deps }),
      getDayCloseState({ userId: ME, localDate: TODAY, deps }),
    ]);
    expect(legacy).toBe(state.isComplete);
  });
});

// The labels themselves: three registers doing three jobs is what makes
// them one rhythm, so the shape is worth pinning too.
describe('the closing beat labels (OD1 job 9d)', () => {
  it('counts in words to three, then numerals — matching today.tsx\'s own habit', () => {
    expect(STRINGS.checkinMoreTodayCta(1)).toBe('one more today');
    expect(STRINGS.checkinMoreTodayCta(2)).toBe('two more today');
    expect(STRINGS.checkinMoreTodayCta(3)).toBe('three more today');
    // MAX_CIRCLES allows up to 10, so past three must still read.
    expect(STRINGS.checkinMoreTodayCta(4)).toBe('4 more today');
  });

  it('the three states never say the same thing, and only one is a farewell', () => {
    const notDone = STRINGS.checkinMoreTodayCta(2);
    const done = STRINGS.checkinSeeYouTomorrowCta;
    const cardDay = STRINGS.checkinCardComingCta;
    expect(new Set([notDone, done, cardDay]).size).toBe(3);
    // (c) leads INTO the card; it must never be the goodbye, which the
    // card screen itself owns (job 8's shareCardCloseCta).
    expect(cardDay).not.toBe(done);
    expect(cardDay).not.toBe(STRINGS.shareCardCloseCta);
    expect(done).toBe(STRINGS.shareCardCloseCta);
  });

  it('all three are lowercase fragments (LC2: button labels are not prose)', () => {
    for (const label of [
      STRINGS.checkinMoreTodayCta(2),
      STRINGS.checkinSeeYouTomorrowCta,
      STRINGS.checkinCardComingCta,
    ]) {
      expect(label).toBe(label.toLowerCase());
    }
  });
});
