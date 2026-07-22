import { AVATAR_VARIANT_COUNT, avatarVariantForUserId } from './avatar';

describe('avatarVariantForUserId', () => {
  it('is deterministic — same id, same penguin, every call', () => {
    const id = 'aaaa1111-0000-4000-8000-000000001a01';
    const first = avatarVariantForUserId(id);
    for (let i = 0; i < 50; i++) expect(avatarVariantForUserId(id)).toBe(first);
  });

  it('always lands in 1..10', () => {
    for (let i = 0; i < 200; i++) {
      const v = avatarVariantForUserId(`probe-${i}-${i * 7919}`);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(AVATAR_VARIANT_COUNT);
    }
  });

  // The AV1 uniformity pin: ≥1000 synthetic ids, 10 buckets, no bucket
  // wildly off 10%. The ids are deliberately RELATED (uuid-shaped,
  // differing only in their tail digits — the worst case NQ2's session
  // found for a weak hash), so a lost avalanche mix fails this loudly.
  it('spreads related uuid-shaped ids evenly across the 10 variants', () => {
    const N = 2000;
    const buckets = new Array(AVATAR_VARIANT_COUNT).fill(0);
    for (let i = 0; i < N; i++) {
      const tail = String(i).padStart(12, '0');
      buckets[avatarVariantForUserId(`c0ffee00-0000-4000-8000-${tail}`) - 1]++;
    }
    const expected = N / AVATAR_VARIANT_COUNT; // 200
    for (const count of buckets) {
      // ±40% of the expected share — generous enough for real hash
      // variance at N=2000, far too tight for a skewed hash to sneak
      // through (the pre-mix FNV baseline concentrates whole buckets).
      expect(count).toBeGreaterThan(expected * 0.6);
      expect(count).toBeLessThan(expected * 1.4);
    }
  });

  it('spreads plain sequential ids too (fixture-style inputs)', () => {
    const N = 1000;
    const buckets = new Array(AVATAR_VARIANT_COUNT).fill(0);
    for (let i = 0; i < N; i++) buckets[avatarVariantForUserId(`user-${i}`) - 1]++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan((N / AVATAR_VARIANT_COUNT) * 0.6);
      expect(count).toBeLessThan((N / AVATAR_VARIANT_COUNT) * 1.4);
    }
  });
});
