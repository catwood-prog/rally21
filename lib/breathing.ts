/**
 * BR1 (16 July) — the breathing pacer's phase clock, pure. One number
 * (milliseconds into the breath cycle) drives everything the pacer
 * renders — circle scale, circle opacity, and both phase labels — so the
 * label crossfade and the swell can never drift apart: they're all
 * derived from the same t. The timing/amplitude values themselves live
 * in lib/motion.ts (BREATHING_PACER) per the P1 convention; these
 * functions take them as parameters so this module stays dependency-free
 * and unit-testable under plain Jest.
 *
 * Every function carries the 'worklet' directive because the component
 * calls them from useAnimatedStyle on the UI thread; under Jest the
 * directive is an inert expression statement.
 */

/** The same curve as motion.ts's BREATHE_EASE (Easing.inOut(Easing.sin)),
 * written out so worklets and tests share one implementation without
 * importing reanimated here. */
export function easeInOutSine(x: number): number {
  'worklet';
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

/** Milliseconds into the current cycle, wrapped into [0, inMs + outMs). */
export function cycleTime(tMs: number, inMs: number, outMs: number): number {
  'worklet';
  const cycle = inMs + outMs;
  return ((tMs % cycle) + cycle) % cycle;
}

/** Which half of the breath t falls in — the in-breath owns [0, inMs). */
export function breathPhaseAt(tMs: number, inMs: number, outMs: number): 'in' | 'out' {
  'worklet';
  return cycleTime(tMs, inMs, outMs) < inMs ? 'in' : 'out';
}

/** Breath fullness at t: 0 = fully settled, 1 = fully swelled. Rises
 * eased over the in-breath, settles eased over the (longer) out-breath —
 * the circle's scale and opacity both map linearly from this. */
export function breathProgressAt(tMs: number, inMs: number, outMs: number): number {
  'worklet';
  const t = cycleTime(tMs, inMs, outMs);
  if (t < inMs) return easeInOutSine(t / inMs);
  return easeInOutSine(1 - (t - inMs) / outMs);
}

/** Opacity of the "breathe in" label at t (the "breathe out" label is its
 * complement, 1 - this). Each label crossfades in across a short window
 * that starts exactly at its own phase boundary — the words a person
 * reads always belong to the phase that just began, and the function is
 * continuous across the cycle wrap (0 at the end of the out-breath, 0 an
 * instant into the in-breath, rising from there). */
export function inLabelOpacityAt(tMs: number, inMs: number, outMs: number, fadeMs: number): number {
  'worklet';
  const t = cycleTime(tMs, inMs, outMs);
  if (t < fadeMs) return t / fadeMs;
  if (t < inMs) return 1;
  if (t < inMs + fadeMs) return 1 - (t - inMs) / fadeMs;
  return 0;
}
