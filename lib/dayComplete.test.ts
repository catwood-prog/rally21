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

  // DD1 (5 Aug) — "remaining" is now also what decides whether the
  // celebration headline may say "done", so the three ways a circle is
  // NOT awaiting anything each get pinned here rather than at the
  // headline, where they would be a second mechanism.
  it('a FINISHED membership is never awaiting — PA2 stopped asking, so this stops counting', async () => {
    // today.tsx is explicit ("a finished member is never asked to check
    // in") and skips the check-in flow entirely on myFinishedAt. Before
    // DD1 this traversal disagreed: it counted the finished circle,
    // inflating "N more today" AND holding the day open permanently —
    // a member who finishes one of two circles could never reach a done
    // day again, so the farewell and the share card would simply stop.
    const state = await getDayCloseState({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [
          fakeCircle({ id: 'a' }),
          fakeCircle({ id: 'finished', myFinishedAt: '2026-07-19T00:00:00Z' }),
        ],
        getCirclePresence: async (id) => (id === 'a' ? [{ userId: ME, localDate: TODAY }] : []),
      },
    });
    expect(state).toEqual({ isComplete: true, awaitingCount: 0 });
  });

  it('finished circles do not inflate the count either', async () => {
    const state = await getDayCloseState({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [
          fakeCircle({ id: 'a' }),
          fakeCircle({ id: 'b' }),
          fakeCircle({ id: 'finished', myFinishedAt: '2026-07-19T00:00:00Z' }),
        ],
        getCirclePresence: async (id) => (id === 'a' ? [{ userId: ME, localDate: TODAY }] : []),
      },
    });
    // 'b' alone is awaiting; 'finished' is not a practice anyone is
    // waiting on, so the button says "one more today", not "two".
    expect(state).toEqual({ isComplete: false, awaitingCount: 1 });
  });

  it('finishing everything but one circle collapses to the single-circle short-circuit', async () => {
    // The exclusion happens BEFORE the `active.length <= 1` test, so a
    // member down to one live circle gets job 9c's zero-fetch path — and
    // therefore always gets "done", exactly like anyone else with one.
    const getCirclePresence = jest.fn();
    const state = await getDayCloseState({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [
          fakeCircle({ id: 'a' }),
          fakeCircle({ id: 'finished', myFinishedAt: '2026-07-19T00:00:00Z' }),
          fakeCircle({ id: 'archived', completedAt: '2026-07-20T00:00:00Z' }),
        ],
        getCirclePresence,
      },
    });
    expect(state).toEqual({ isComplete: true, awaitingCount: 0 });
    expect(getCirclePresence).not.toHaveBeenCalled();
  });

  it('an RS2 AWAY row is presence, so an away-held circle is never awaiting', async () => {
    // RS2's away pause is person-level (users.away_since), not per
    // circle, and return_from_away() leaves one 'away'-kind completions
    // row per held day behind. hasPresenceToday is kind-blind, so those
    // rows read as presence here exactly as they do for the picker's
    // per-row mark (lib/circle.test.ts pins the same decision for
    // myStateInCircle) — the two can never disagree about the same day.
    //
    // The LIVE half of the pause needs no test because it cannot reach
    // this function: lib/checkin.ts's saveCompletion calls
    // return_from_away() on every check-in, so a caller of this is never
    // currently away.
    // The rows carry their real `kind` — DayCloseDeps' row type is a
    // structural subset of lib/circle's CirclePresenceRow, which is what
    // the production getCirclePresence actually hands over, so this is
    // the shape the traversal really sees rather than a reduction of it.
    const awayRow = { userId: ME, localDate: TODAY, kind: 'away' as const, coveredBy: null };
    const selfRow = { userId: ME, localDate: TODAY, kind: 'self' as const, coveredBy: null };
    const state = await getDayCloseState({
      userId: ME,
      localDate: TODAY,
      deps: {
        listMyCircles: async () => [fakeCircle({ id: 'a' }), fakeCircle({ id: 'held' })],
        getCirclePresence: async (id) => (id === 'a' ? [selfRow] : [awayRow]),
      },
    });
    expect(state).toEqual({ isComplete: true, awaitingCount: 0 });
    // And the same row on somebody else's account is still not mine.
    expect(hasPresenceToday([{ ...awayRow, userId: 'other' }], ME, TODAY)).toBe(false);
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

  it('the FOUR end-of-day labels: exactly one farewell, and it is shared by the screens that close', () => {
    // Cat's ruling, 26 July. The last screen owns the goodbye; every
    // label answers "is the day done?"; non-last screens lead forward.
    //
    //   checkin-complete  not done          -> N more today
    //   checkin-complete  done, glow next   -> keep it glowing
    //   checkin-complete  done, card next   -> something for you
    //   checkin-complete  done, last        -> see you tomorrow
    //   glow-beat         not done          -> keep it glowing
    //   glow-beat         done  (last)      -> see you tomorrow
    //   share-card        (always done, last)-> see you tomorrow
    const forward = [
      STRINGS.checkinMoreTodayCta(2),
      STRINGS.glowBeatContinueCta,
      STRINGS.checkinCardComingCta,
    ];
    // Not one of the forward labels may be the farewell.
    for (const label of forward) expect(label).not.toBe(STRINGS.dayDoneCta);
    // The two screens that can be last say the SAME farewell, so the day
    // ends the same way whichever one closes it.
    expect(STRINGS.dayDoneCta).toBe(STRINGS.shareCardCloseCta);
  });

  it('"keep it glowing" is reused across two screens but never within one day', () => {
    // It shows on checkin-complete only when the day IS done, and on
    // glow-beat only when it is NOT — mutually exclusive, so a person
    // sees it on exactly one screen per day and never twice in a row.
    // This test documents the invariant the two call sites rely on.
    const onCheckinComplete = (dayDone: boolean) => dayDone;
    const onGlowBeat = (dayDone: boolean) => !dayDone;
    for (const dayDone of [true, false]) {
      expect(onCheckinComplete(dayDone) && onGlowBeat(dayDone)).toBe(false);
    }
  });

  it('the three states never say the same thing, and only one is a farewell', () => {
    const notDone = STRINGS.checkinMoreTodayCta(2);
    const done = STRINGS.dayDoneCta;
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
      STRINGS.dayDoneCta,
      STRINGS.checkinCardComingCta,
    ]) {
      expect(label).toBe(label.toLowerCase());
    }
  });
});
