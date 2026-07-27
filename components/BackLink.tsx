import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';

import { colors } from '@/constants/theme';

/** The height of the link's own line box: fontSize 13 at the explicit
 * lineHeight below. Pinned rather than left to each platform's default so
 * the negative margin that cancels the 44px target is exact everywhere
 * (RNW resolves an unset lineHeight to ~1.2em, iOS and Android to their
 * own metrics — three different answers, three different offsets). */
const LINE_BOX = 16;
const TARGET = 44;

/**
 * OD1 job 13 (26 July) — the one back-link.
 *
 * It was hand-rolled at 21 in-flow sites, near-identical every time
 * (fontSize 13 / weight 600 / colors.muted, with only the trailing margin
 * varying), and it was the single most-repeated control in the app. All
 * three of its defects converged on the same element: no spoken label, a
 * tap target that was just the 13px text, and `colors.muted` at 3.00:1 —
 * under WCAG's 4.5:1 for small text. Fixing it once fixes all three, and
 * LC1 having had to sweep every one of these by hand for casing is the
 * argument for it being a component now.
 *
 * THE TARGET, and why it is built this way (job 13c: web must be PROVABLY
 * unchanged in appearance): a 44px-tall box cannot occupy a 16px line's
 * worth of vertical space on its own. So the touchable really is 44 high
 * and vertically centred — a genuine target on every platform — and
 * `marginVertical: -(44 - 16) / 2` gives the surrounding layout back the
 * 28px it grew by, leaving an outer wrapper exactly 16 high: the line box
 * the hand-rolled version occupied, to the pixel. The text's baseline and
 * every neighbour's position are unmoved; the touch area is what changed.
 *
 * The caller's spacing goes on the OUTER wrapper and the compensation on
 * the INNER touchable, deliberately — the same shape as job 3's fix to
 * AppHeader. If both shared one element, a call site passing the trailing
 * `marginBottom: 16` it already had would override the -14 bottom half of
 * the compensation and silently push its whole screen down 14px.
 *
 * hitSlop is NOT the mechanism: react-native-web 0.21.2 does not implement
 * it at all (zero occurrences in its source), so it would have left web's
 * target at the bare 13px text while looking correct in review.
 *
 * The touchable overhangs its neighbours by 14px top and bottom, which is
 * why `alignSelf: 'flex-start'` matters beyond looks — it keeps the link a
 * narrow left-aligned box, clear of AppHeader's house/gear targets on the
 * right, so the overhang cannot swallow their taps.
 *
 * NOT used by the five ABSOLUTELY-POSITIONED back controls (sign-in x2,
 * privacy-promise, reminders, profile) — they float over the screen at a
 * per-screen `top`, so they have no flow to preserve and this component's
 * compensation would shift them. profile.tsx's is not a back link at all;
 * it signs you out. See the job 13 handoff.
 */
export function BackLink({
  label,
  onPress,
  style,
  accessibilityLabel,
}: {
  /** Destination words only, lowercase, no arrow — the component draws the
   * arrow, since chrome is not copy. LC1's casing law governs this text. */
  label: string;
  onPress: () => void;
  /** Per-screen spacing only (the trailing margin the old hand-rolled
   * style carried). Never restyle the link itself through this. */
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <View style={style}>
      <TouchableOpacity
        style={styles.tap}
        onPress={onPress}
        accessibilityRole="button"
        // Destination-specific, so a screen-reader user hears where it goes
        // rather than "back" 21 times. "← back" has no destination to name.
        accessibilityLabel={accessibilityLabel ?? (label === 'back' ? 'back' : `back to ${label}`)}
      >
        <Text style={styles.text}>← {label}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  tap: {
    minHeight: TARGET,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginVertical: -(TARGET - LINE_BOX) / 2,
  },
  text: {
    fontSize: 13,
    lineHeight: LINE_BOX,
    fontWeight: '600',
    // OD1 job 10: colors.muted is 3.00:1 on bg and 3.09:1 on card, under
    // the 4.5:1 small-text bar. mutedStrong is the palette's existing
    // AA-passing quiet ink (5.01:1 / 5.29:1) — already in theme.ts since
    // PM1B, so this costs no palette-wide change.
    color: colors.mutedStrong,
  },
});
