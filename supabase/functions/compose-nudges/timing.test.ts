import {
  JITTER_BAND_MINUTES,
  LEAD_MINUTES_BEFORE_USUAL_TIME,
  MIN_SAMPLE_SIZE,
  computeSmartSendTime,
  hhmmToMinutes,
  jitterMinutes,
  medianMinutes,
  minutesToHHMM,
} from './timing';

describe('hhmmToMinutes / minutesToHHMM', () => {
  it('round-trips', () => {
    expect(hhmmToMinutes('08:30')).toBe(510);
    expect(minutesToHHMM(510)).toBe('08:30');
  });

  it('wraps negative minutes into the previous day', () => {
    expect(minutesToHHMM(-10)).toBe('23:50');
  });

  it('wraps minutes past midnight', () => {
    expect(minutesToHHMM(1450)).toBe('00:10');
  });
});

describe('medianMinutes', () => {
  it('returns null for an empty sample', () => {
    expect(medianMinutes([])).toBeNull();
  });

  it('takes the middle value for an odd sample', () => {
    expect(medianMinutes([480, 500, 490])).toBe(490);
  });

  it('averages the two middle values for an even sample', () => {
    expect(medianMinutes([480, 500, 490, 510])).toBe(495);
  });

  it('is not dragged by a single outlier', () => {
    // four evening check-ins (~20:00) and one 2am insomnia one
    const samples = [1200, 1205, 1195, 1210, 120];
    expect(medianMinutes(samples)).toBe(1200);
  });
});

describe('jitterMinutes', () => {
  it('is deterministic for the same seed', () => {
    const a = jitterMinutes('user-1||2026-07-13', 8);
    const b = jitterMinutes('user-1||2026-07-13', 8);
    expect(a).toBe(b);
  });

  it('stays within the requested band', () => {
    for (const seed of ['a', 'bb', 'ccc', 'user-42||2026-01-01', 'user-42||2026-01-02']) {
      const j = jitterMinutes(seed, JITTER_BAND_MINUTES);
      expect(j).toBeGreaterThanOrEqual(-JITTER_BAND_MINUTES);
      expect(j).toBeLessThanOrEqual(JITTER_BAND_MINUTES);
    }
  });

  it('usually differs across different local dates for the same user', () => {
    const days = Array.from({ length: 14 }, (_, i) => jitterMinutes(`user-1||2026-07-${String(i + 1).padStart(2, '0')}`, 8));
    const distinct = new Set(days);
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('computeSmartSendTime', () => {
  const userId = 'user-1';
  const localDate = '2026-07-13';

  it('falls back to the unjittered default below the minimum sample size', () => {
    const samples = Array(MIN_SAMPLE_SIZE - 1).fill(1200);
    const result = computeSmartSendTime({ timeOfDaySamplesMinutes: samples, fallbackTime: '08:00:00', userId, localDate });
    expect(result).toBe('08:00');
  });

  it('never guesses wildly on cold start regardless of local date', () => {
    const a = computeSmartSendTime({ timeOfDaySamplesMinutes: [], fallbackTime: '19:30', userId, localDate: '2026-07-13' });
    const b = computeSmartSendTime({ timeOfDaySamplesMinutes: [], fallbackTime: '19:30', userId, localDate: '2026-07-14' });
    expect(a).toBe('19:30');
    expect(b).toBe('19:30');
  });

  it('targets a lead before the learned median time once enough samples exist', () => {
    const samples = Array(MIN_SAMPLE_SIZE).fill(1200); // 20:00 every day, no jitter noise
    const result = computeSmartSendTime({
      timeOfDaySamplesMinutes: samples,
      fallbackTime: '08:00',
      userId,
      localDate,
      jitterBandMinutes: 0, // isolate the lead-offset behavior from jitter
    });
    expect(hhmmToMinutes(result)).toBe(1200 - LEAD_MINUTES_BEFORE_USUAL_TIME);
  });

  it('is deterministic: same user + same local date computes the identical time on re-run', () => {
    const samples = [1190, 1200, 1210, 1205, 1195, 1200];
    const a = computeSmartSendTime({ timeOfDaySamplesMinutes: samples, fallbackTime: '08:00', userId, localDate });
    const b = computeSmartSendTime({ timeOfDaySamplesMinutes: samples, fallbackTime: '08:00', userId, localDate });
    expect(a).toBe(b);
  });

  it('gives different jittered minutes on a different local date with the same history', () => {
    const samples = [1190, 1200, 1210, 1205, 1195, 1200];
    const times = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'].map((d) =>
      computeSmartSendTime({ timeOfDaySamplesMinutes: samples, fallbackTime: '08:00', userId, localDate: d })
    );
    expect(new Set(times).size).toBeGreaterThan(1);
  });
});
