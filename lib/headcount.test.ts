import { headcountLine, type HeadcountMember } from './headcount';

/** A roster member, active unless told otherwise. */
const m = (userId: string, edge?: Partial<HeadcountMember>): HeadcountMember => ({
  userId,
  isResting: false,
  awaySince: null,
  finishedAt: null,
  ...edge,
});
const inToday = (...userIds: string[]) => new Set(userIds);

// AU1 job 2 — the regression that matters most is the exact render Cat
// saw, so it is asserted as a whole sentence rather than as a shape.
describe('headcountLine — AU1 job 2', () => {
  it('never puts a circle name where a count of people belongs (the reported render)', () => {
    // The old line read "that's all 1 of Breath of Fire & Fists of Anger
    // - morning boost in today 🔥" — a circle name in the slot where a
    // group-of-people noun belongs. Whenever the lone shape fires it says
    // "everyone" and names nothing.
    const line = headcountLine([m('cat')], inToday('cat'));
    expect(line).toBe("that's everyone in today 🔥");
    expect(line).not.toMatch(/all 1 of/);
  });

  it('celebrates a real full circle with the count, no name', () => {
    expect(headcountLine([m('a'), m('b'), m('c'), m('d')], inToday('a', 'b', 'c', 'd'))).toBe(
      "that's all 4 of you in today 🔥"
    );
    expect(headcountLine([m('a'), m('b')], inToday('a', 'b'))).toBe(
      "that's all 2 of you in today 🔥"
    );
  });

  it('reads the partial day plainly', () => {
    expect(headcountLine([m('a'), m('b'), m('c'), m('d')], inToday('a'))).toBe('1 of 4 in today');
    expect(headcountLine([m('a'), m('b')], inToday())).toBe('0 of 2 in today');
  });

  it('never celebrates an empty room', () => {
    // 0 === 0 satisfied the old equality: an active roster that has gone
    // entirely quiet used to render the all-in celebration. Note the
    // roster is NOT empty here — two real members, both at the edge.
    const line = headcountLine([m('a', { isResting: true }), m('b', { awaySince: '2026-08-01' })], inToday());
    expect(line).toBe('nobody in yet today');
    expect(line).not.toMatch(/🔥/);
  });

  it('keeps the numerator inside the denominator when an EDGE member checks in', () => {
    // AU1's "3 of 2" shape, at its new boundary. An away member can check
    // in (away is a stored state, not derived from quiet days), and their
    // row used to be counted by a numerator that read every completion.
    // Both counts now come off one roster, so the pair cannot cross: the
    // away member is ticked, is not in the denominator, and does not
    // inflate the numerator.
    const line = headcountLine(
      [m('a'), m('b'), m('away', { awaySince: '2026-08-01' })],
      inToday('a', 'away')
    );
    expect(line).toBe('1 of 2 in today');
    expect(line).not.toMatch(/2 of 2|3 of 2/);
  });

  it('says nothing about the members who have gone quiet', () => {
    // Warmth law: misses cost something, shame costs nothing. No shape of
    // this line may name, count or imply the absent.
    const rosters: [HeadcountMember[], Set<string>][] = [
      [[m('a')], inToday('a')],
      [[m('a', { isResting: true })], inToday()],
      [[m('a'), m('b'), m('c'), m('d')], inToday('a')],
      [[m('a'), m('b'), m('c'), m('d')], inToday('a', 'b', 'c', 'd')],
      [[m('a'), m('b', { isResting: true })], inToday('a')],
    ];
    for (const [roster, present] of rosters) {
      expect(headcountLine(roster, present)).not.toMatch(
        /miss|missing|absent|resting|away|only|still|left/i
      );
    }
  });
});

// HC1 (Cat's ruling 2, 16 Aug) — the two 🔥 branches gain a
// rendered-ticked guard. These are the tests that fail against d732fd0.
describe('headcountLine — HC1, the celebration may not fire over an unticked avatar', () => {
  it('THE FLIP CASE: Cat 17:12, 16 Aug, "Read before bed"', () => {
    // Alex Stewart's last completion was 11 Aug — exactly
    // RESTING_QUIET_DAYS_THRESHOLD days back, so he left the active
    // roster on the morning she looked, dropping it to one and taking the
    // lone-celebration branch while his own penguin sat unticked beneath
    // the sentence. Against d732fd0 this asserted
    // "that's everyone in today 🔥".
    const line = headcountLine(
      [m('alex', { isResting: true }), m('cathy')],
      inToday('cathy')
    );
    expect(line).toBe('1 of 1 in today');
    expect(line).not.toMatch(/🔥|everyone/);
  });

  it('blocks the GROUP celebration too, not just the lone one', () => {
    // Three active and all in, one finished member unticked beside them.
    // Against d732fd0: "that's all 3 of you in today 🔥".
    const line = headcountLine(
      [m('a'), m('b'), m('c'), m('done', { finishedAt: '2026-08-10' })],
      inToday('a', 'b', 'c')
    );
    expect(line).toBe('3 of 3 in today');
    expect(line).not.toMatch(/🔥/);
  });

  it('THE NEGATIVE CONTROL: an all-ticked roster still celebrates, both shapes', () => {
    // The guard must not have turned the 🔥 off. Nobody at the edge, so
    // the roster and the active roster are the same set.
    expect(headcountLine([m('a'), m('b'), m('c')], inToday('a', 'b', 'c'))).toBe(
      "that's all 3 of you in today 🔥"
    );
    expect(headcountLine([m('a')], inToday('a'))).toBe("that's everyone in today 🔥");
  });

  it('an EDGE member who checked in does not block the 🔥 — they are ticked', () => {
    // The guard asks "is every face ticked", not "is nobody at the edge".
    // An away or finished member who checked in today wears a tick the
    // reader can see, so the celebration is true of the card.
    expect(
      headcountLine(
        [m('a'), m('b'), m('away', { awaySince: '2026-08-01' })],
        inToday('a', 'b', 'away')
      )
    ).toBe("that's all 2 of you in today 🔥");
    expect(
      headcountLine([m('a'), m('done', { finishedAt: '2026-08-10' })], inToday('a', 'done'))
    ).toBe("that's everyone in today 🔥");
  });

  it('a member hidden in the "+N" chip still blocks the 🔥 (the guard is PRE-cap)', () => {
    // circle.tsx slices its avatar row to MAX_AVATARS_SHOWN = 8 and folds
    // the rest into "+N", and it passes `orderedMembers` — the full source
    // roster — rather than `shownMembers`. Cat ruled the stricter input:
    // a 🔥 over a hidden absentee is the same false claim as one over a
    // visible absentee, only harder to catch. RS1 orders the edge FIRST,
    // so the overflow is exactly where quiet members land.
    const nine = Array.from({ length: 9 }, (_, i) => m(`member-${i}`));
    const allButLast = nine.slice(0, 8).map((x) => x.userId);
    expect(headcountLine(nine, inToday(...allButLast))).toBe('8 of 9 in today');
    expect(headcountLine(nine, inToday(...nine.map((x) => x.userId)))).toBe(
      "that's all 9 of you in today 🔥"
    );
  });
});
