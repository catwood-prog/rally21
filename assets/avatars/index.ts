// AV1 — the ten placeholder penguin avatars (Rally21-Mascot-Brief.md →
// "Placeholder penguin avatars"). Single require() point, same pattern
// as assets/mascot. ARRAY ORDER IS CANONICAL and must stay filename
// order (avatar-01 … avatar-10): lib/avatar.ts's deterministic
// hash(user id) → variant mapping indexes into it, so reordering this
// list would silently reassign every photo-less member's penguin.
//
// Placement-law amendment #2 (the brief, Cat's ruling 20 July): the
// penguin may stand in for a PERSON in persistent chrome — these
// avatars — but never appear as decoration. There is NO initials
// fallback anymore; the penguin replaced it entirely.
//
// Bundled at 256×256 PNG (alpha preserved — JPEG would box them),
// palette-compressed: crisp at 3x the largest render site (cover.tsx's
// 88px disc → 264 logical px; every other site is ≤84px). ~254KB total
// for all ten.
export const AVATAR_PENGUINS = [
  require('./avatar-01-classic.png'),
  require('./avatar-02-beanie-green.png'),
  require('./avatar-03-beanie-plum.png'),
  require('./avatar-04-beanie-slate.png'),
  require('./avatar-05-beanie-coral.png'),
  require('./avatar-06-glasses.png'),
  require('./avatar-07-earmuffs.png'),
  require('./avatar-08-bow.png'),
  require('./avatar-09-headphones.png'),
  require('./avatar-10-tuft.png'),
] as const;
