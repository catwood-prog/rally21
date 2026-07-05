import { StyleProp, Text, TextStyle } from 'react-native';

import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { colors } from '@/constants/theme';

/**
 * The one and only place "Rally21" gets typeset — "Rally" in the header
 * extra-bold, "21" in the serif italic accent, gold, no space between.
 * Never recreate this with per-screen Text styles (see CLAUDE.md).
 */
const BASE_SIZE = 16;
const BASE_LETTER_SPACING = -0.3;

export function Brandmark({
  size = 24,
  light = false,
  style,
}: {
  size?: number;
  /** White "Rally" instead of ink — for dark screens like the timer. */
  light?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  // letterSpacing is an absolute px value, not relative to fontSize, so it
  // has to scale with size manually to keep the same visual tightness at
  // any size (the header default is 1.5x the original 16px baseline).
  const letterSpacing = (size / BASE_SIZE) * BASE_LETTER_SPACING;

  return (
    <Text style={[{ fontSize: size, letterSpacing }, style]}>
      <Text style={{ fontFamily: FONT_HEADER, color: light ? '#fff' : colors.ink }}>Rally</Text>
      <Text style={{ fontFamily: FONT_SERIF_ITALIC, color: colors.gold }}>21</Text>
    </Text>
  );
}
