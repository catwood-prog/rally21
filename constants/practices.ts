import { PracticeCategory } from '@/lib/circle-setup';

// PT1: the six taxonomy domains, in the spec's shelf order. Keys and
// order come from lib/practiceTaxonomy.ts (the source of truth); the
// emoji are browse-tile art only until PT2's photo set lands.
export const CATEGORIES: { key: PracticeCategory; label: string; emoji: string }[] = [
  { key: 'move', label: 'Move', emoji: '🏃' },
  { key: 'mind', label: 'Mind', emoji: '🧘' },
  { key: 'learn', label: 'Learn', emoji: '📚' },
  { key: 'make', label: 'Make', emoji: '🎨' },
  { key: 'connect', label: 'Connect', emoji: '🤝' },
  { key: 'care', label: 'Care', emoji: '🌿' },
];
