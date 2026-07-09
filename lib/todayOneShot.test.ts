import { hasPlayedTodayOneShot, markTodayOneShotPlayed } from './todayOneShot';

// BD2 (8 July): this module gained its second caller (glow's one-shot
// from P1, birthday's from BD2) — per CLAUDE.md's own convention, that's
// exactly the moment shared lib/ logic earns a test.
describe('todayOneShot — per-kind, per-date one-shot tracking', () => {
  it('a kind/date pair is unplayed until explicitly marked', () => {
    expect(hasPlayedTodayOneShot('glow', '2026-09-01')).toBe(false);
  });

  it('marking played makes it read played for that exact kind/date', () => {
    markTodayOneShotPlayed('glow', '2026-09-02');
    expect(hasPlayedTodayOneShot('glow', '2026-09-02')).toBe(true);
  });

  it('two different kinds on the SAME date never collide — a glow one-shot and a birthday one-shot the same day are tracked independently', () => {
    markTodayOneShotPlayed('glow', '2026-09-03');
    expect(hasPlayedTodayOneShot('birthday', '2026-09-03')).toBe(false);
    markTodayOneShotPlayed('birthday', '2026-09-03');
    expect(hasPlayedTodayOneShot('glow', '2026-09-03')).toBe(true);
    expect(hasPlayedTodayOneShot('birthday', '2026-09-03')).toBe(true);
  });

  it('the same kind on a DIFFERENT date is unplayed — a birthday one-shot never bleeds into the next year', () => {
    markTodayOneShotPlayed('birthday', '2026-09-04');
    expect(hasPlayedTodayOneShot('birthday', '2026-09-05')).toBe(false);
  });
});
