import { StyleSheet, Text, View } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { colors, scaledLineHeight } from '@/constants/theme';
import { SpotContent } from '@/lib/notificationSpot';

/**
 * TN1 (24 July, mockup APPROVED — Rally21-Today-WelcomeBack-Mockup.html,
 * frames A/B/C) — Today's ONE notification surface: a warm green-tinted
 * card at the top of Today carrying the re-entry moment (frame A) and
 * everyday warmth (frame C). Frame B is the default: `content` is null
 * and this renders nothing at all, so Today is exactly its live layout.
 *
 * Deliberately NOT a badge shape and never a count: warmth or absence
 * (Rally21-Glow-Spec.md §0 — shame costs nothing). Nothing here is red.
 * The whole render decision lives in lib/notificationSpot.ts; this file
 * is only the mockup's visual target.
 */
export function TodayNotificationSpot({ content }: { content: SpotContent | null }) {
  if (!content) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{content.kicker}</Text>
      {content.headline ? <Text style={styles.headline}>{content.headline}</Text> : null}
      {content.lines.map((line) => (
        <Text key={line.key} style={styles.momentLine}>
          {line.text}
        </Text>
      ))}
      {content.overflowCount > 0 ? (
        <Text style={styles.momentLine}>{STRINGS.todaySpotOverflow(content.overflowCount)}</Text>
      ) : null}
      {content.footnote ? <Text style={styles.footnote}>{content.footnote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Green: this surface is togetherness/aliveness, never an alert. The
  // 1.5px outline is what lifts it off `bg` without a shadow competing
  // with the practice card below it.
  card: {
    backgroundColor: colors.greenSoft,
    borderWidth: 1.5,
    borderColor: colors.green,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 18,
    gap: 4,
  },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    // colors.green fails AA on greenSoft at this size — the palette's
    // deeper green is the readable member of the family.
    color: colors.greenDeep,
  },
  headline: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.ink,
    lineHeight: scaledLineHeight(20),
  },
  momentLine: {
    fontSize: 13,
    color: colors.mutedStrong,
    lineHeight: scaledLineHeight(18),
  },
  footnote: {
    fontSize: 11.5,
    color: colors.mutedStrong,
    lineHeight: scaledLineHeight(16),
    marginTop: 2,
  },
});
