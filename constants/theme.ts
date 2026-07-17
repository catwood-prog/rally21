// Palette lifted from the rev-7 mockup. Full type/font polish is a later
// pass (build plan week 2); this just keeps early screens on-brand.
// M2 (16 July colour ruling): celebration confetti is ALWAYS green —
// gold stays the scarf/action colour, green owns "you did it." One
// family around colors.green (#5BA85B): base, a lighter tint, a deeper
// shade. THE source of truth for every ConfettiBurst/ConfettiPiece
// caller (day-21, birthday, check-in success, celebration markers).
export const CONFETTI_GREENS = ['#5BA85B', '#7FBF7F', '#3E7C3E'] as const;

export const colors = {
  gold: '#F4C84B',
  green: '#5BA85B',
  ink: '#262626',
  bg: '#F2F1EC',
  card: '#FFFFFF',
  muted: 'rgba(38, 38, 38, 0.5)',
  line: 'rgba(0, 0, 0, 0.09)',
  // The mascot spec's slightly warmer/lighter cream — distinct from `bg`,
  // used only on the surfaces that spec called out explicitly (check-in
  // success, chat) rather than a blanket app-wide rebrand.
  cream: '#F7F5F0',
  // Soft green fill for confirmed/positive surfaces (badges, "sounds
  // right" states, unlocked hints) — promoted from repeated literals.
  greenSoft: '#EAF3EA',
  // Gold at low opacity — "mine"/active chip fills, gold-tinted banners
  // and pills. Promoted from a repeated literal.
  goldSoft: 'rgba(244, 200, 75, 0.15)',
  // Dimmed gold for the glow's embers state (Rally21-Glow-Spec.md §2) —
  // never red, the flame just quiets rather than alarms.
  goldMuted: 'rgba(244, 200, 75, 0.65)',
  // Dusk plum — the inner-life layer's accent (journal, reflections,
  // day-14 observation). Scarce by design: plum only ever means "your
  // private picture" (see CLAUDE.md's color-roles convention).
  plum: '#7A6486',
  plumSoft: '#F0EBF3',
  // Hearts — warmth between friends (AC1, 15 July; see CLAUDE.md's
  // color-roles convention). Scarce and specific: only the heart gesture
  // and its 🧡 mark, never a CTA or a status color.
  heart: '#C2410C',
  heartSoft: 'rgba(194, 65, 12, 0.15)',
  // Error/destructive text and borders — promoted from repeated literals.
  errorRed: '#B3261E',
  // Modal/sheet backdrop dim — promoted from a repeated literal.
  overlay: 'rgba(0, 0, 0, 0.4)',
};

// The mockup's ".card" box-shadow: 0 6px 16px rgba(0,0,0,0.05) — spread
// this into any card-like container's style so it's defined once.
// react-native-web translates these standard RN shadow properties into
// a real CSS box-shadow; elevation covers Android.
export const cardShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.05,
  shadowRadius: 16,
  elevation: 3,
} as const;

// The mockup's chip/pill sizing — spread into any selectable option chip's
// container/text styles so the geometry stops drifting per screen. Colors
// (background, border, selected state) stay per-screen since those vary by
// context.
export const chipShape = {
  paddingVertical: 6,
  paddingHorizontal: 13,
  borderRadius: 99,
} as const;

export const chipTextShape = {
  fontSize: 11.5,
  fontWeight: '700',
} as const;
