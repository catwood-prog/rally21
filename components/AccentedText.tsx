import { StyleProp, Text, TextStyle } from 'react-native';

import { FONT_SERIF_ITALIC } from '@/constants/fonts';
import { colors } from '@/constants/theme';

/**
 * Renders text where *word or phrase* segments (matching the adaptive
 * spec's "personal words" convention in the question bank) get the
 * Instrument Serif italic accent treatment; everything else renders plain.
 */
export function AccentedText({
  text,
  style,
  accentStyle,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  accentStyle?: StyleProp<TextStyle>;
}) {
  const parts = text.split(/\*(.+?)\*/g);

  return (
    <Text style={style}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={[styles.accent, accentStyle]}>
            {part}
          </Text>
        ) : (
          part
        )
      )}
    </Text>
  );
}

const styles = {
  accent: {
    fontFamily: FONT_SERIF_ITALIC,
    color: colors.green,
  } as TextStyle,
};
