import { attachRestingStatus, CircleMember, CirclePresenceRow, isSoloCircle, mapCircleRow, myStateInCircle, MyCircle, resolveCircleSelection, selectFromMyCircles } from './circle';

function fakeMember(overrides: Partial<CircleMember> = {}): CircleMember {
  return {
    userId: 'user-1',
    name: 'Alex',
    avatarUrl: null,
    role: 'member',
    birthMonth: null,
    birthDay: null,
    celebrateBirthday: true,
    timezone: null,
    joinedAt: '2026-06-01T00:00:00Z',
    awaySince: null,
    finishedAt: null,
    ...overrides,
  };
}

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

describe('mapCircleRow — the circle-first duration read (PB1)', () => {
  const baseRow = {
    id: 'circle-1',
    name: 'Daily Meditation',
    time_of_day: '08:00:00',
    start_date: '2026-06-01',
    duration_days: 21,
    invite_code: 'ABC123',
    created_by: 'user-1',
    resource_url: null,
    instructions: null,
    is_public: false,
    closed_to_joins: false,
    rallied_on_at: null,
    completed_at: null,
  };

  test('the circle\'s own duration wins over the practice\'s legacy value', () => {
    const circle = mapCircleRow({
      ...baseRow,
      duration_minutes: 15,
      practices: { name: 'Meditate', duration_minutes: 5, created_by: null },
    });
    expect(circle.durationMinutes).toBe(15);
  });

  test('a circle predating the backfill falls back to the practice\'s legacy duration', () => {
    const circle = mapCircleRow({
      ...baseRow,
      duration_minutes: null,
      practices: { name: 'Meditate 10 minutes', duration_minutes: 10, created_by: null },
    });
    expect(circle.durationMinutes).toBe(10);
  });

  test('no duration anywhere means no timer — null, never 0', () => {
    const circle = mapCircleRow({
      ...baseRow,
      duration_minutes: null,
      practices: { name: 'Take my vitamins', duration_minutes: null, created_by: null },
    });
    expect(circle.durationMinutes).toBeNull();
  });

  // OD1 job 16c (Cat's ruling, 26 July) — origin decides whether a
  // practice name may be re-cased on Today, so the discriminator itself
  // is worth pinning: it is created_by, and NOT is_shared.
  test('a seeded practice (created_by null) is ours to lowercase', () => {
    const circle = mapCircleRow({
      ...baseRow,
      duration_minutes: null,
      practices: { name: 'Meditate 10 minutes', duration_minutes: 10, created_by: null },
    });
    expect(circle.practiceIsUserCreated).toBe(false);
  });

  test('a user-created practice is theirs, and stays theirs once a public circle shares it', () => {
    const circle = mapCircleRow({
      ...baseRow,
      duration_minutes: null,
      practices: { name: 'Read before bed', duration_minutes: null, created_by: 'user-9' },
    });
    // is_shared would have flipped true the moment a public circle used
    // this practice; created_by never moves, which is why it is the test.
    expect(circle.practiceIsUserCreated).toBe(true);
  });

  test('no practice row at all keeps the old behaviour rather than claiming authorship', () => {
    expect(mapCircleRow({ ...baseRow, duration_minutes: null, practices: null }).practiceIsUserCreated).toBe(false);
  });

  test('PI1 — the host\'s instructions map straight through (null stays null)', () => {
    expect(
      mapCircleRow({ ...baseRow, duration_minutes: null, instructions: null, practices: null })
        .instructions
    ).toBeNull();
    expect(
      mapCircleRow({
        ...baseRow,
        duration_minutes: null,
        instructions: '3 rounds — 10 breaths, rest a minute',
        practices: null,
      }).instructions
    ).toBe('3 rounds — 10 breaths, rest a minute');
  });
});

describe('selectFromMyCircles (HY1 job 1 / R3 — the primary-circle law from a list already in hand)', () => {
  test('exactly one circle is unambiguous', () => {
    const circle = fakeCircle();
    expect(selectFromMyCircles([circle])).toEqual({ kind: 'single', circle });
  });

  test('zero circles resolves to a null circle rather than crashing', () => {
    expect(selectFromMyCircles([])).toEqual({ kind: 'single', circle: null });
  });

  test('more than one circle ASKS — it never returns circles[0]', () => {
    // THE REGRESSION THIS PINS: today.tsx's multi-circle reflection
    // teaser opened `circles[0]`'s check-in, and a completed check-in
    // WRITES a completion — so a guess here recorded someone's day
    // against a circle they never chose.
    const circleA = fakeCircle({ id: 'circle-a', name: 'Circle A' });
    const circleB = fakeCircle({ id: 'circle-b', name: 'Circle B' });

    const result = selectFromMyCircles([circleA, circleB]);

    expect(result).toEqual({ kind: 'picker', circles: [circleA, circleB] });
    expect(result.kind).not.toBe('single');
  });

  test('three circles still ask — the rule is "more than one", not "exactly two"', () => {
    const circles = [
      fakeCircle({ id: 'a' }),
      fakeCircle({ id: 'b' }),
      fakeCircle({ id: 'c' }),
    ];
    expect(selectFromMyCircles(circles)).toEqual({ kind: 'picker', circles });
  });

  test('resolveCircleSelection and selectFromMyCircles cannot disagree', async () => {
    // The async entry point delegates to this one on purpose: two copies
    // of "more than one" is how a screen ends up with its own quiet
    // exception to the law.
    const circles = [fakeCircle({ id: 'a' }), fakeCircle({ id: 'b' })];
    const viaFetch = await resolveCircleSelection(undefined, 'user-1', {
      getCircleById: jest.fn(),
      listMyCircles: jest.fn().mockResolvedValue(circles),
    });

    expect(viaFetch).toEqual(selectFromMyCircles(circles));
  });
});

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

describe('attachRestingStatus (RS1)', () => {
  test('a long-quiet member is flagged resting; order and other fields are untouched', () => {
    const quiet = fakeMember({ userId: 'user-quiet', joinedAt: '2026-06-01T00:00:00Z' });
    const active = fakeMember({ userId: 'user-active', joinedAt: '2026-06-01T00:00:00Z' });
    const presence = [{ userId: 'user-active', localDate: '2026-07-13' }];

    const result = attachRestingStatus([quiet, active], presence, '2026-07-13');

    expect(result.map((m) => m.userId)).toEqual(['user-quiet', 'user-active']);
    expect(result[0]).toMatchObject({ userId: 'user-quiet', isResting: true, name: 'Alex' });
    expect(result[1]).toMatchObject({ userId: 'user-active', isResting: false });
  });

  test('a member who joined yesterday is never resting, even with zero presence rows', () => {
    const freshJoiner = fakeMember({ userId: 'user-new', joinedAt: '2026-07-12T00:00:00Z' });

    const result = attachRestingStatus([freshJoiner], [], '2026-07-13');

    expect(result[0].isResting).toBe(false);
  });
});

describe('myStateInCircle (HY1 job 8 — the picker row\u2019s mark for YOU)', () => {
  const TODAY = '2026-08-05';
  const ME = 'me';

  const row = (o: Partial<CirclePresenceRow> = {}): CirclePresenceRow => ({
    userId: ME,
    localDate: TODAY,
    kind: 'self',
    coveredBy: null,
    createdAt: `${TODAY}T09:00:00Z`,
    ...o,
  });

  const members = [{ userId: ME }, { userId: 'them' }];

  test('a self check-in today reads done', () => {
    expect(myStateInCircle({ userId: ME, members, presence: [row()], today: TODAY })).toBe('done');
  });

  test('no row for today reads not-yet', () => {
    expect(
      myStateInCircle({ userId: ME, members, presence: [row({ localDate: '2026-08-04' })], today: TODAY })
    ).toBe('pending');
  });

  test('NOT LOADED reads as nothing at all — never as "not yet"', () => {
    // THE WRONG CLAIM THIS PREVENTS. The picker fills its per-circle data
    // one circle at a time, so a row renders before its members and
    // presence arrive. A bare `inTodayIds.has(me)` is false then and
    // would tell someone they had not shown up today when the app had
    // simply not looked yet.
    expect(myStateInCircle({ userId: ME, members: [], presence: [], today: TODAY })).toBeNull();
  });

  test('no session reads as nothing — the mark is about YOU or it is absent', () => {
    expect(myStateInCircle({ userId: undefined, members, presence: [row()], today: TODAY })).toBeNull();
  });

  test('a COVERED day is its own state, never a quiet tick', () => {
    // CLAUDE.md's cover-a-friend rule: a cover is a celebrated gift, not
    // a substitute for done. A covered row sits in today's presence
    // exactly like a self check-in, so `has(me)` alone would flatten it.
    expect(
      myStateInCircle({
        userId: ME,
        members,
        presence: [row({ kind: 'covered', coveredBy: 'them' })],
        today: TODAY,
      })
    ).toBe('covered');
  });

  test('covered WINS over a same-day self row — the gift is the thing that happened', () => {
    expect(
      myStateInCircle({
        userId: ME,
        members,
        presence: [row(), row({ kind: 'covered', coveredBy: 'them' })],
        today: TODAY,
      })
    ).toBe('covered');
  });

  test('somebody ELSE\u2019s day is never mistaken for yours', () => {
    expect(
      myStateInCircle({ userId: ME, members, presence: [row({ userId: 'them' })], today: TODAY })
    ).toBe('pending');
  });

  test('an RS2 away row reads done — pinned as OBSERVED, and deliberately', () => {
    // completions.kind gained a third value, 'away', with RS2: one
    // protective row per held day, backfilled by return_from_away(). It
    // is presence without showing up, so "you're in" is arguably
    // generous — but the avatar strip three lines below this mark's call
    // site counts every kind the same way, and a row whose badge and
    // whose mark disagreed about the same day would be worse than a
    // generous one. If that ever gets tightened, tighten BOTH, and this
    // test is where the decision is written down.
    //
    // The cast is not laziness: lib/circle.ts's PresenceKind is
    // `'self' | 'covered'` and has never been widened to RS2's third
    // value, while getCirclePresence casts `row.kind as PresenceKind` —
    // so an away row DOES arrive on the client wearing a type that says
    // it cannot exist. Reported, not fixed here.
    const away = { ...row(), kind: 'away' } as unknown as CirclePresenceRow;
    expect(myStateInCircle({ userId: ME, members, presence: [away], today: TODAY })).toBe('done');
  });
});
