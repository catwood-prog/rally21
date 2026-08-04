import { headcountLine } from './headcount';

// AU1 job 2 — the regression that matters most is the exact render Cat
// saw, so it is asserted as a whole sentence rather than as a shape.
describe('headcountLine — AU1 job 2', () => {
  it('never puts a circle name where a count of people belongs (the reported render)', () => {
    // Cat's Today, 2 August: active roster of one (her circle-mate quiet
    // since 23 July), her own check-in in. The old line read
    // "that's all 1 of Breath of Fire & Fists of Anger - morning boost
    // in today 🔥".
    expect(headcountLine(1, 1)).toBe("that's everyone in today 🔥");
    expect(headcountLine(1, 1)).not.toMatch(/all 1 of/);
  });

  it('celebrates a real full circle with the count, no name', () => {
    expect(headcountLine(4, 4)).toBe("that's all 4 of you in today 🔥");
    expect(headcountLine(2, 2)).toBe("that's all 2 of you in today 🔥");
  });

  it('reads the partial day plainly', () => {
    expect(headcountLine(1, 4)).toBe('1 of 4 in today');
    expect(headcountLine(0, 2)).toBe('0 of 2 in today');
  });

  it('never celebrates an empty room', () => {
    // 0 === 0 satisfied the old equality: an active roster that has gone
    // entirely quiet used to render the all-in celebration.
    expect(headcountLine(0, 0)).toBe('nobody in yet today');
    expect(headcountLine(0, 0)).not.toMatch(/🔥/);
  });

  it('cannot render more people in than there are (the "3 of 2" shape)', () => {
    // Callers pass an active-only numerator, so this is unreachable in
    // the app — pinned because the belt is what makes that true even if
    // a future call site forgets the intersection.
    expect(headcountLine(3, 2)).toBe("that's all 2 of you in today 🔥");
    expect(headcountLine(3, 2)).not.toMatch(/3 of 2/);
  });

  it('says nothing about the members who have gone quiet', () => {
    // Warmth law: misses cost something, shame costs nothing. No shape
    // of this line may name, count or imply the absent.
    for (const [inCount, active] of [[1, 1], [0, 0], [1, 4], [4, 4]]) {
      expect(headcountLine(inCount, active)).not.toMatch(
        /miss|missing|absent|resting|away|only|still|left/i
      );
    }
  });
});
