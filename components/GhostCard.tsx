import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';

/**
 * SK1 job 4 — the ghosted placeholder card from the reflections-off
 * mockups (Rally21-Reflections-Off-States-Mockup.html): a faded card
 * with grey bars where words would be.
 *
 * It shows the SHAPE of what is dormant without inventing any content —
 * the curiosity law's whole point. Nothing here is ever derived from a
 * real entry, so it can't accidentally imply the app is holding
 * something back. Purely decorative, so it's hidden from screen readers;
 * the one true line beneath it does the telling.
 */
export function GhostCard({ widths }: { widths: number[] }) {
  return (
    <View style={styles.card} accessible={false} importantForAccessibility="no-hide-descendants">
      {widths.map((width, i) => (
        <View key={i} style={[styles.line, { width: `${width}%` }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    opacity: 0.45,
  },
  line: {
    height: 9,
    borderRadius: 5,
    backgroundColor: 'rgba(38, 38, 38, 0.12)',
    marginVertical: 6,
  },
});
