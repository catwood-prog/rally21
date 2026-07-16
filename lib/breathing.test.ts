import { breathPhaseAt, breathProgressAt, cycleTime, easeInOutSine, inLabelOpacityAt } from './breathing';

// BR1 — the pacer's phase clock. Cadence values here mirror
// lib/motion.ts's BREATHING_PACER v1 (4s in / 6s out, 500ms label fade)
// but are passed explicitly: the functions are parameterized so Cat's
// retuning of the constants can never silently invalidate these
// boundary assertions.
const IN = 4000;
const OUT = 6000;
const CYCLE = IN + OUT;
const FADE = 500;

describe('breathing — cycleTime', () => {
  it('wraps t into [0, cycle)', () => {
    expect(cycleTime(0, IN, OUT)).toBe(0);
    expect(cycleTime(CYCLE, IN, OUT)).toBe(0);
    expect(cycleTime(CYCLE + 1500, IN, OUT)).toBe(1500);
    expect(cycleTime(7 * CYCLE + 9999, IN, OUT)).toBe(9999);
  });

  it('a negative t (defensive — the clock itself never goes negative) still lands in [0, cycle)', () => {
    expect(cycleTime(-1, IN, OUT)).toBe(CYCLE - 1);
  });
});

describe('breathing — breathPhaseAt', () => {
  it('the in-breath owns [0, inMs), the out-breath owns the rest', () => {
    expect(breathPhaseAt(0, IN, OUT)).toBe('in');
    expect(breathPhaseAt(IN - 1, IN, OUT)).toBe('in');
    expect(breathPhaseAt(IN, IN, OUT)).toBe('out');
    expect(breathPhaseAt(CYCLE - 1, IN, OUT)).toBe('out');
    expect(breathPhaseAt(CYCLE, IN, OUT)).toBe('in');
  });
});

describe('breathing — breathProgressAt', () => {
  it('settled at the cycle start, fully swelled exactly at the in/out boundary, settled again at the wrap', () => {
    expect(breathProgressAt(0, IN, OUT)).toBeCloseTo(0, 6);
    expect(breathProgressAt(IN, IN, OUT)).toBeCloseTo(1, 6);
    expect(breathProgressAt(CYCLE, IN, OUT)).toBeCloseTo(0, 6);
  });

  it('hits the midpoint halfway through each phase (sine in-out is symmetric)', () => {
    expect(breathProgressAt(IN / 2, IN, OUT)).toBeCloseTo(0.5, 6);
    expect(breathProgressAt(IN + OUT / 2, IN, OUT)).toBeCloseTo(0.5, 6);
  });

  it('is eased, not linear — a quarter into the in-breath sits well below 0.25', () => {
    const quarter = breathProgressAt(IN / 4, IN, OUT);
    expect(quarter).toBeCloseTo(easeInOutSine(0.25), 6);
    expect(quarter).toBeLessThan(0.25);
  });

  it('rises monotonically over the in-breath and settles monotonically over the out-breath', () => {
    for (let t = 100; t <= IN; t += 100) {
      expect(breathProgressAt(t, IN, OUT)).toBeGreaterThan(breathProgressAt(t - 100, IN, OUT));
    }
    for (let t = IN + 100; t <= CYCLE; t += 100) {
      expect(breathProgressAt(t, IN, OUT)).toBeLessThan(breathProgressAt(t - 100, IN, OUT));
    }
  });

  it('is continuous across the in/out boundary and the cycle wrap', () => {
    expect(breathProgressAt(IN - 1, IN, OUT)).toBeCloseTo(breathProgressAt(IN + 1, IN, OUT), 2);
    expect(breathProgressAt(CYCLE - 1, IN, OUT)).toBeCloseTo(breathProgressAt(CYCLE + 1, IN, OUT), 2);
  });
});

describe('breathing — inLabelOpacityAt (the "breathe out" label is its complement)', () => {
  it('"breathe in" fades in across the window that starts exactly as the in-breath begins', () => {
    expect(inLabelOpacityAt(0, IN, OUT, FADE)).toBe(0);
    expect(inLabelOpacityAt(FADE / 2, IN, OUT, FADE)).toBeCloseTo(0.5, 6);
    expect(inLabelOpacityAt(FADE, IN, OUT, FADE)).toBe(1);
  });

  it('holds fully visible for the rest of the in-breath', () => {
    expect(inLabelOpacityAt(IN / 2, IN, OUT, FADE)).toBe(1);
    expect(inLabelOpacityAt(IN - 1, IN, OUT, FADE)).toBe(1);
  });

  it('hands over to "breathe out" across the window that starts exactly at the out-breath boundary', () => {
    expect(inLabelOpacityAt(IN, IN, OUT, FADE)).toBe(1);
    expect(inLabelOpacityAt(IN + FADE / 2, IN, OUT, FADE)).toBeCloseTo(0.5, 6);
    expect(inLabelOpacityAt(IN + FADE, IN, OUT, FADE)).toBe(0);
  });

  it('stays handed over for the rest of the out-breath, including right up to the wrap', () => {
    expect(inLabelOpacityAt(IN + OUT / 2, IN, OUT, FADE)).toBe(0);
    expect(inLabelOpacityAt(CYCLE - 1, IN, OUT, FADE)).toBe(0);
  });

  it('is continuous across the cycle wrap (0 at the end of the out-breath, rising from 0 into the next in-breath)', () => {
    expect(inLabelOpacityAt(CYCLE - 1, IN, OUT, FADE)).toBe(0);
    expect(inLabelOpacityAt(CYCLE + 1, IN, OUT, FADE)).toBeCloseTo(1 / FADE, 6);
  });

  it('after each fade window, the dominant label always matches breathPhaseAt', () => {
    for (let t = 0; t < CYCLE; t += 50) {
      const inCycle = cycleTime(t, IN, OUT);
      const pastFade = inCycle >= FADE && (inCycle < IN || inCycle >= IN + FADE);
      if (!pastFade) continue;
      const dominant = inLabelOpacityAt(t, IN, OUT, FADE) > 0.5 ? 'in' : 'out';
      expect(dominant).toBe(breathPhaseAt(t, IN, OUT));
    }
  });
});
