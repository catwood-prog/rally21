import { StyleProp, Text, TextStyle } from 'react-native';

import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { colors } from '@/constants/theme';

/**
 * The one and only place "Rally21" gets typeset — "Rally" in the header
 * extra-bold, "21" in the serif italic accent, gold, no space between.
 * Never recreate this with per-screen Text styles (see CLAUDE.md).
 */
export function Brandmark({
  size = 16,
  light = false,
  style,
}: {
  size?: number;
  /** White "Rally" instead of ink — for dark screens like the timer. */
  light?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text style={[{ fontSize: size, letterSpacing: -0.3 }, style]}>
      <Text style={{ fontFamily: FONT_HEADER, color: light ? '#fff' : colors.ink }}>Rally</Text>
      <Text style={{ fontFamily: FONT_SERIF_ITALIC, color: colors.gold }}>21</Text>
    </Text>
  );
}
