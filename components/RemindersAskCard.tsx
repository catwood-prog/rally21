import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors, scaledLineHeight } from '@/constants/theme';

/** RM1 (13 July) — the reminders ask (mockup screen 6, rev-7): "full" is
 * the onboarding step shown once between profile and circle-setup;
 * "compact" is the one-time dismissible Today card for existing users.
 * Both render the identical headline/body/CTA copy so the moment reads
 * the same regardless of which surface a given account sees it on. */
export function RemindersAskCard({
  variant,
  onTurnOn,
  onMaybeLater,
}: {
  variant: 'full' | 'compact';
  onTurnOn: () => void;
  onMaybeLater: () => void;
}) {
  const compact = variant === 'compact';

  return (
    <View style={compact ? styles.compactWrap : styles.fullWrap}>
      <Text style={styles.bell}>🔔</Text>
      <Text style={[styles.title, compact && styles.titleCompact]}>
        {STRINGS.remindersAskTitleLead}
        <Text style={styles.titleAccent}>{STRINGS.remindersAskTitleAccent}</Text>
        {STRINGS.remindersAskTitleTrail}
      </Text>
      <Text style={styles.body}>{STRINGS.remindersAskBody}</Text>
      <TouchableOpacity style={styles.cta} onPress={onTurnOn}>
        <Text style={styles.ctaText}>{STRINGS.remindersAskCta}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onMaybeLater}>
        <Text style={styles.maybeLater}>{STRINGS.remindersAskMaybeLater}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  fullWrap: {
    // OD1 job 17a — flexGrow, not flex: 1. `flex: 1` carries flexBasis: 0,
    // which pins this wrap to exactly one viewport no matter how tall its
    // content grows, so the reminders screen's new ScrollView would have
    // had nothing to scroll. flexGrow keeps short content centred and lets
    // tall content size the scroll. Only the 'full' (onboarding) variant
    // uses this; the compact Today card is unaffected.
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  compactWrap: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    marginBottom: 16,
    ...cardShadow,
  },
  bell: {
    fontSize: 36,
    marginBottom: 14,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 22,
    // OD1 job 17c — YD1's fix: iOS scales glyphs but not a fixed
    // lineHeight, clipping wrapping copy. Both variants wrap, so both
    // get it. Web and Android are returned unchanged.
    lineHeight: scaledLineHeight(27),
    letterSpacing: -0.3,
    color: colors.ink,
    textAlign: 'center',
  },
  titleCompact: {
    fontSize: 18,
    lineHeight: scaledLineHeight(23),
  },
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    color: colors.green,
  },
  body: {
    fontSize: 13,
    color: colors.muted,
    // OD1 job 17c — the longest copy on the ask, so the worst clipper.
    lineHeight: scaledLineHeight(19),
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  cta: {
    backgroundColor: colors.green,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  ctaText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#fff',
  },
  maybeLater: {
    marginTop: 14,
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
});
