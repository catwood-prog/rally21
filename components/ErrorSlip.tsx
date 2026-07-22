import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { MascotEntrance } from '@/components/MascotEntrance';
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
export function ErrorSlip({ message, style }: { message: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.wrap, style]}>
      <MascotEntrance source={MASCOT.apologeticSlip} style={styles.mascot} />
      <Text style={styles.message}>{message}</Text>
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
    color: colors.muted,
    lineHeight: 19,
    textAlign: 'center',
  },
});
