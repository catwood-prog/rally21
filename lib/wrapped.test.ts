/**
 * SC3 — pins the Wrapped card's data composition: counts must be TRUE
 * (derived from the same presence rows the app already trusts), a
 * covered day is held (never shown-up), and a self row always beats a
 * covered row on the same day.
 */
import { composeWrappedData } from './wrapped';

const U = 'me';
const OTHER = 'someone-else';

function presenceRow(localDate: string, kind: 'self' | 'covered', userId = U) {
  return { userId, localDate, kind: kind as 'self' | 'covered' };
}

describe('composeWrappedData', () => {
  it('maps 21 journey days to earned/held/none and counts truthfully', () => {
    const presence = [
      presenceRow('2026-07-01', 'self'),
      presenceRow('2026-07-02', 'self'),
      presenceRow('2026-07-03', 'covered'),
      presenceRow('2026-07-05', 'self'),
      // someone else's rows never leak into my card
      presenceRow('2026-07-04', 'self', OTHER),
      presenceRow('2026-07-06', 'covered', OTHER),
    ];
    const data = composeWrappedData({
      userId: U,
      circleStartDate: '2026-07-01',
      milestoneDay: 21,
      presence,
    });
    expect(data.dots).toHaveLength(21);
    expect(data.dots.slice(0, 6)).toEqual(['earned', 'earned', 'held', 'none', 'earned', 'none']);
    expect(data.dots.slice(6).every((d) => d === 'none')).toBe(true);
    expect(data.shownUp).toBe(3);
    expect(data.held).toBe(1);
  });

  it('a self completion beats a covered row on the same day, in either order', () => {
    for (const rows of [
      [presenceRow('2026-07-01', 'covered'), presenceRow('2026-07-01', 'self')],
      [presenceRow('2026-07-01', 'self'), presenceRow('2026-07-01', 'covered')],
    ]) {
      const data = composeWrappedData({
        userId: U,
        circleStartDate: '2026-07-01',
        milestoneDay: 21,
        presence: rows,
      });
      expect(data.dots[0]).toBe('earned');
      expect(data.shownUp).toBe(1);
      expect(data.held).toBe(0);
    }
  });

  it('generalizes to later milestones (the 50-day stop renders 50 dots)', () => {
    const data = composeWrappedData({
      userId: U,
      circleStartDate: '2026-07-01',
      milestoneDay: 50,
      presence: [presenceRow('2026-08-19', 'self')], // day 50
    });
    expect(data.dots).toHaveLength(50);
    expect(data.dots[49]).toBe('earned');
    expect(data.shownUp).toBe(1);
  });

  it('a perfect 21 counts 21 shown up, zero held', () => {
    const presence = Array.from({ length: 21 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 1 + i));
      return presenceRow(
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
        'self'
      );
    });
    const data = composeWrappedData({ userId: U, circleStartDate: '2026-07-01', milestoneDay: 21, presence });
    expect(data.shownUp).toBe(21);
    expect(data.held).toBe(0);
    expect(data.dots.every((dot) => dot === 'earned')).toBe(true);
  });
});
