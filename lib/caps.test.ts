/**
 * HY1 job 6 (R8) — lib/caps.ts, first test.
 *
 * WHAT IS ACTUALLY AT STAKE. The caps are ENFORCED IN SQL (`app_caps()`,
 * consulted by create_circle / join_circle_by_code / join_public_circle /
 * count_open_circles_by_practice), so nothing here can let anyone past a
 * cap. What this function decides is what the app SAYS and OFFERS — the
 * "+ add a circle" button versus the circle-cap screen — and it is
 * auth.uid()-aware server-side, because Cat's founder account carries a
 * higher personal cap while she runs the cohort.
 *
 * So the failure that matters is the fallback: if a failed read returned
 * something falsy, an ordinary member would be told they had no circles
 * left, and Cat would be pushed back down to 3 in the middle of the
 * invite window. Every branch below exists to pin that the fallback is
 * the PRODUCT DEFAULT and never zero.
 */
import { CIRCLE_MEMBER_CAP, getMyCircleCap, MAX_CIRCLES } from './caps';
import { supabase } from './supabase';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => {
  rpc.mockReset();
});

test('the product defaults are the numbers the server enforces', () => {
  // Hand-synced with app_caps()'s own defaults. If these ever drift, the
  // app offers a button the server refuses — check the SQL, not this file.
  expect(MAX_CIRCLES).toBe(3);
  expect(CIRCLE_MEMBER_CAP).toBe(12);
});

test('returns the personal cap the server reports (the founder allowlist path)', async () => {
  rpc.mockResolvedValue({ data: [{ max_circles_per_user: 10 }], error: null });

  await expect(getMyCircleCap()).resolves.toBe(10);
  expect(rpc).toHaveBeenCalledWith('app_caps');
});

test('returns the product default for an ordinary account', async () => {
  rpc.mockResolvedValue({ data: [{ max_circles_per_user: 3 }], error: null });
  await expect(getMyCircleCap()).resolves.toBe(3);
});

test('an ERRORED read falls back to the default — never 0, never undefined', async () => {
  // The bug this guards: a falsy fallback would tell someone in one
  // circle that they were at their limit.
  rpc.mockResolvedValue({ data: null, error: { message: 'network' } });
  await expect(getMyCircleCap()).resolves.toBe(MAX_CIRCLES);
});

test('an EMPTY result set falls back to the default', async () => {
  rpc.mockResolvedValue({ data: [], error: null });
  await expect(getMyCircleCap()).resolves.toBe(MAX_CIRCLES);
});

test('a row with a null cap column falls back to the default', async () => {
  // `?? MAX_CIRCLES`, not `|| MAX_CIRCLES` — pinned separately from the
  // no-row case because a present-but-null column takes a different
  // branch and is the one a schema change would produce.
  rpc.mockResolvedValue({ data: [{ max_circles_per_user: null }], error: null });
  await expect(getMyCircleCap()).resolves.toBe(MAX_CIRCLES);
});

test('a server cap LOWER than the default is honoured, not floored to it', async () => {
  // The fallback is for failure, not for disagreement: if the server ever
  // narrows a cap deliberately, the app must say the server's number
  // rather than quietly offering more than it will allow.
  rpc.mockResolvedValue({ data: [{ max_circles_per_user: 1 }], error: null });
  await expect(getMyCircleCap()).resolves.toBe(1);
});
