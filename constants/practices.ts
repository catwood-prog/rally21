import { PracticeCategory } from '@/lib/circle-setup';

// PT1/PT3: the five taxonomy domains, in the spec's shelf order (connect
// retired in the 17 July re-cut). Keys and order come from
// lib/practiceTaxonomy.ts (the source of truth); the emoji are the
// tile-art fallback and picker-chip decoration.
export const CATEGORIES: { key: PracticeCategory; label: string; emoji: string }[] = [
  { key: 'move', label: 'Move', emoji: '🏃' },
  { key: 'mind', label: 'Mind', emoji: '🧘' },
  { key: 'learn', label: 'Learn', emoji: '📚' },
  { key: 'make', label: 'Make', emoji: '🎨' },
  { key: 'care', label: 'Care', emoji: '🌿' },
];
