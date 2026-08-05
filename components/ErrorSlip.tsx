import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { MascotEntrance } from '@/components/MascotEntrance';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';

/**
 * ER1 — the placement map's Error surface, everywhere a whole moment
 * fails (Cat's 6 July ruling, re-confirmed 21 July: "Error/404 →
 * apologetic-slip, medium"). Slip at medium = the 404's own 150×88;
 * standard entrance + reduced-motion static both come from
 * MascotEntrance. One mascot per screen: a surface renders this INSTEAD
 * of any placed mascot (the error state replaces it, never stacks).
 * Inline field errors, toasts, and lines under live content stay
 * text-only by design — this marks whole-moment failures only.
 */
export function ErrorSlip({
  message,
  style,
  onRetry,
}: {
  message: string;
  style?: StyleProp<ViewStyle>;
  /** HY1 job 7 — the warm retry. OPTIONAL, and deliberately so: every
   * load-failure line in the app already ends "…try again", which is
   * only fair advice on a screen that offers something to tap. Pass it
   * where a re-run genuinely costs nothing and is likely to work (a
   * timed-out load); leave it off where the failure is not the kind a
   * second attempt fixes, so the slip never invites a person to tap
   * their way into the same wall. */
  onRetry?: () => void;
}) {
  return (
    <View style={[styles.wrap, style]}>
      <MascotEntrance source={MASCOT.apologeticSlip} style={styles.mascot} />
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={styles.retry} accessibilityRole="button">
          <Text style={styles.retryText}>{STRINGS.retryCta}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  mascot: {
    width: 150,
    height: 88,
    marginBottom: 12,
  },
  message: {
    fontSize: 13.5,
    color: colors.mutedStrong,
    lineHeight: 19,
    textAlign: 'center',
  },
  // A quiet text link, not a CTA: gold would read as the thing to do
  // here, and the thing to do is usually just wait a moment. minHeight
  // carries the ≥44px tap target while the type stays subordinate.
  retry: {
    marginTop: 6,
    paddingVertical: 12,
    paddingHorizontal: 20,
    minHeight: 44,
    justifyContent: 'center',
  },
  retryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.greenText,
    textAlign: 'center',
  },
});
