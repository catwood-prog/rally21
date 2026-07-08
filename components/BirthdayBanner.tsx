import { StyleSheet, Text, View } from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { MascotEntrance } from '@/components/MascotEntrance';
import { FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';

/** BD1 — the user's own birthday moment on Today. A legitimate mascot
 * placement per the brief (an emotional peak, once a year), rendered via
 * the standard MascotEntrance. Only mounted on the birthday itself, so the
 * penguin still appears at most once on a normal day. */
export function BirthdayBanner({ name }: { name: string | null }) {
  return (
    <View style={styles.wrap}>
      <MascotEntrance source={MASCOT.penguinConfetti} style={styles.mascot} />
      <Text style={styles.line}>{STRINGS.birthdaySelfLine(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  mascot: {
    width: 96,
    height: 96,
  },
  line: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 22,
    color: colors.ink,
    marginTop: 4,
    textAlign: 'center',
  },
});
