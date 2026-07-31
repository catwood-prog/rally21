import { StyleProp, Text, TextStyle } from 'react-native';

import { FONT_SERIF_ITALIC } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { ACCENT_SPAN } from '@/lib/accentMarkup';

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
  const parts = text.split(ACCENT_SPAN);

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
  // CT3 (29 July) — greenText, NOT greenDisplay, and this one is a trap
  // worth naming. This component sets no fontSize: it inherits from the
  // caller, and its ONLY caller is check-in's question prompt at 14px
  // (checkin.tsx `questionPrompt`). So despite being a serif accent like
  // the display ones, it renders as SMALL text and 4.5:1 governs —
  // greenDisplay's ~3:1 would fail here. greenText is 4.64:1 on bg.
  // If a future caller renders this at 24px+ on bg/card/cream, THAT call
  // site can take greenDisplay via the `accentStyle` prop; the default
  // stays on the safe token, because the default is what an unaudited
  // new caller gets.
  accent: {
    fontFamily: FONT_SERIF_ITALIC,
    color: colors.greenText,
  } as TextStyle,
};
