import { didRekindleToday, shouldShowGlowBeat, WeekDay } from './glow';

// G5 (7 July): the glow moment only shows on the check-in that earns the
// day, and never alongside a milestone celebration (they compose, never
// both) — this is the one piece of G5's logic simple enough to unit test
// without a live DB.
describe('shouldShowGlowBeat', () => {
  it('shows the beat when the check-in earned the day and there is no milestone', () => {
    expect(shouldShowGlowBeat({ earnedToday: true, hasMilestone: false })).toBe(true);
  });

  it('never shows the beat on a milestone day, even if the day was earned', () => {
    expect(shouldShowGlowBeat({ earnedToday: true, hasMilestone: true })).toBe(false);
  });

  it('does not show the beat for a second-circle completion or an edit (not earned)', () => {
    expect(shouldShowGlowBeat({ earnedToday: false, hasMilestone: false })).toBe(false);
  });

  it('does not show the beat when neither earned nor milestone', () => {
    expect(shouldShowGlowBeat({ earnedToday: false, hasMilestone: true })).toBe(false);
  });
});

function week(states: WeekDay['state'][]): WeekDay[] {
  return states.map((state, i) => ({ date: `2026-07-0${i + 1}`, state }));
}

describe('didRekindleToday', () => {
  it('is true when yesterday was missed and today is earned', () => {
    expect(didRekindleToday(week(['earned', 'earned', 'none', 'earned']))).toBe(true);
  });

  it('is false for an ordinary earned streak (yesterday also earned)', () => {
    expect(didRekindleToday(week(['earned', 'earned', 'earned', 'earned']))).toBe(false);
  });

  it('is false when yesterday was held by a cover, not missed', () => {
    expect(didRekindleToday(week(['earned', 'earned', 'held', 'earned']))).toBe(false);
  });

  it('is false when today itself is not earned', () => {
    expect(didRekindleToday(week(['earned', 'none', 'none', 'none']))).toBe(false);
  });

  it('is false for a week shorter than 2 days', () => {
    expect(didRekindleToday(week(['earned']))).toBe(false);
  });
});
