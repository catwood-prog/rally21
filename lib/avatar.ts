// AV1 — deterministic penguin assignment for photo-less members.
// hash(user id) → variant 1–10: the same person gets the same penguin
// everywhere, every day, on every viewer's device. The hash input is
// the user id ALONE — no date, no circle — so the mapping can never
// drift between surfaces or sessions.

export const AVATAR_VARIANT_COUNT = 10;

/** FNV-1a over the id's UTF-16 code units, finished with the murmur3
 * avalanche mix. The mix matters: NQ2's session found that related
 * seeds (uuids sharing most of their bytes — exactly what sequential
 * or fixture ids look like) produce badly skewed picks under a plain
 * multiplicative hash; the finalizer spreads every input bit across
 * the output before the modulo. Uniformity is pinned by the spread
 * test in lib/avatar.test.ts. */
function avalancheHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The member's penguin: 1-based variant index into the canonical
 * filename order (assets/avatars/index.ts). */
export function avatarVariantForUserId(userId: string): number {
  return (avalancheHash(userId) % AVATAR_VARIANT_COUNT) + 1;
}
