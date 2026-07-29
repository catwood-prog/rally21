import { PixelRatio, Platform } from 'react-native';

// Palette lifted from the rev-7 mockup. Full type/font polish is a later
// pass (build plan week 2); this just keeps early screens on-brand.
// M2 (16 July colour ruling): celebration confetti is ALWAYS green —
// gold stays the scarf/action colour, green owns "you did it." One
// family around colors.green (#5BA85B): base, a lighter tint, a deeper
// shade. THE source of truth for every ConfettiBurst/ConfettiPiece
// caller (day-21, birthday, check-in success, celebration markers).
export const CONFETTI_GREENS = ['#5BA85B', '#7FBF7F', '#3E7C3E'] as const;

// TB1 (18 July) — the floating tab bar's geometry, shared between the
// bar itself and every tab screen's bottom clearance (audit rule: any
// scrolling tab screen pads with CLEARANCE so content never hides
// under the pill; the composer uses its own tighter constant).
export const FLOATING_TAB_BAR = {
  HEIGHT: 56,
  SIDE_MARGIN: 16,
  BOTTOM_GAP: 12,
  // Bar height + gap + a breathing row, sized to clear the pill even
  // with a tall home-indicator inset beneath it.
  CLEARANCE: 128,
  COMPOSER_CLEARANCE: 80,
} as const;

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
  // CONFETTI_GREENS' deep shade, promoted to the palette by TN1 (24
  // July) for small print that has to stay readable ON greenSoft:
  // colors.green over greenSoft lands ~2.4:1, well under AA, so the
  // notification spot's kicker uses the deeper green instead.
  greenDeep: '#3E7C3E',
  // OD1 job 10 (26 July) — the TEXT-weight green. colors.green is a FILL
  // colour and measures 2.58:1 on bg / 2.92:1 on card as text, which
  // fails not only WCAG's 4.5:1 for small text but its 3:1 for LARGE
  // text too — so no green text anywhere was compliant, including the
  // headings job 10c expected to find already passing. greenText is
  // 4.64:1 on bg, 5.25:1 on card and 4.63:1 on greenSoft. Green keeps
  // owning progress; this is the same role at a legible weight.
  // USE THIS FOR TEXT. colors.green stays exactly as it is for fills,
  // borders, bars, confetti and the glow — see 10e and CLAUDE.md.
  greenText: '#3D793D',
  // Gold at low opacity — "mine"/active chip fills, gold-tinted banners
  // and pills. Promoted from a repeated literal.
  goldSoft: 'rgba(244, 200, 75, 0.15)',
  // Dimmed gold for the glow's embers state (Rally21-Glow-Spec.md §2) —
  // never red, the flame just quiets rather than alarms.
  goldMuted: 'rgba(244, 200, 75, 0.65)',
  // Dusk plum — the inner-life layer's accent (journal, reflections,
  // day-14 observation). Scarce by design: plum only ever means "your
  // private map" (see CLAUDE.md's color-roles convention).
  plum: '#7A6486',
  plumSoft: '#F0EBF3',
  // AR4 job 1 (Cat's ruling, 26 July) — the border on a surface that is
  // SPOKEN rather than touched. The bordered surfaces on Ask Rally are
  // otherwise all card + 1.5px plum (starter chips at radius 18, the
  // composer at radius 22), and AR2 gave the greeting bubble the same
  // border for exactly that consistency. Cat overruled it: the chips and
  // the composer are things you TOUCH, the greeting is Rally SPEAKING,
  // and an identical border weight flattens that hierarchy. This lighter
  // shade is what preserved it in the approved mockup.
  // REACH FOR THIS when the surface talks back and cannot be tapped —
  // not for anything interactive, which stays plum. Do not "correct" the
  // greeting bubble back to plum for consistency; the difference is the
  // point.
  spokenBorder: '#C9BFD1',
  // Hearts — warmth between friends (AC1, 15 July) — plus you-are-here,
  // the tab bar's active state (Cat's TB2 ruling, 20 July; see CLAUDE.md's
  // color-roles convention). Scarce and specific: the heart gesture, its
  // 🧡 mark, and the nav active state — never a CTA or a progress color.
  // #D97757 per Cat's OD1 job 23b ruling (23 July): the previous value
  // read red on device; this is a true warm orange, the whole role moved
  // together (hearts, icon wash, pill tint — heartSoft is its 0.15 rgba).
  heart: '#D97757',
  heartSoft: 'rgba(217, 119, 87, 0.15)',
  // Quiet-but-readable ink: THE token for any small print a person has to
  // read. Since CT1 (28 July) that is 200+ sites, not a handful.
  //
  // THE NUMBERS, MEASURED — this comment used to claim `muted` at 0.5
  // "lands ~4.2:1", and that figure was wrong in a way that cost a whole
  // section. 4.19/4.39 are ink at alpha 0.62 on bg/card: measurements of a
  // PROPOSED value, written down as the current one. CT1 inherited the
  // error and built its plan on it. The real figures:
  //   colors.muted (0.50)  3.00:1 on bg, 3.09 on card, and 2.74–3.09
  //                        across every surface in the app — so it clears
  //                        4.5:1 NOWHERE, and on bg (2.9957) it misses even
  //                        the 3:1 large-text bar. It is not a text colour.
  //   mutedStrong (0.70)   5.32 bg · 5.65 card · 5.42 cream · 5.32 greenSoft
  //                        · 5.23 plumSoft · 5.19 goldSoft · 4.86 on the
  //                        placeholder grey · 4.50 on a SOLID gold fill.
  //
  // 0.70, not 0.68, since CT2 (28 July). Solid gold is the binding surface:
  // 0.68 reached only 4.27 there, which is what left splash.tsx's two lines
  // short. 0.69986 is the exact minimum that clears 4.5:1 on gold, so 0.70
  // is that minimum rounded up — a 0.0016 margin on paper, but any path
  // that quantises alpha to 8 bits rounds 0.70 UP (179/255) and measures
  // 4.52, so the tight case is tight only in the arithmetic.
  //
  // Raising the alpha can only raise contrast, so every site already on
  // this token passed a fortiori when 0.68 became 0.70 — nothing needed
  // re-checking except the surfaces that were previously the minimums.
  mutedStrong: 'rgba(38, 38, 38, 0.70)',
  // CH5 — the photo/avatar placeholder grey, promoted from '#ddd'
  // repeated in profile.tsx and Avatar.tsx.
  placeholderGrey: '#ddd',
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

// YD1 (21 July, Cat's on-device find: the away-pause card's sentence cut
// off mid-way) — iOS never scales a fixed lineHeight with Dynamic Type:
// glyphs grow with the user's text size but the line boxes don't, so a
// multi-line Text measured at N unscaled lines clips its tail, worst on
// the longest copy. Android treats lineHeight as SP (already scaled) and
// web ignores fontScale, so only iOS needs the multiply. Any fixed
// lineHeight on wrapping copy goes through this. Reads the scale once at
// module load — a mid-session text-size change needs an app restart to
// re-measure, which is how the rest of the layout behaves anyway.
export function scaledLineHeight(lineHeight: number): number {
  return Platform.OS === 'ios' ? Math.round(lineHeight * PixelRatio.getFontScale()) : lineHeight;
}
