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
  // CT3 (29 July) — greenText, and this is the one borderline call in the
  // set, flagged to Cat rather than settled quietly. This accent sets no
  // fontSize, so it inherits `title` at 22px (the full onboarding variant)
  // or `titleCompact` at 18px (the Today card). WCAG's large-text bar is
  // 24px regular / 18.66px bold, and this is regular weight — so BOTH
  // variants are small text on web, where React Native Web renders
  // fontSize as px. greenDisplay measures ~3:1 and would fail both.
  // greenText clears 4.5:1 on either surface (4.64 on bg, 5.25 on card).
  // If Cat rules this reads as display type rather than a sentence, it is
  // a one-line move to greenDisplay — see the handoff.
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    color: colors.greenText,
  },
  body: {
    fontSize: 13,
    color: colors.mutedStrong,
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
    color: colors.mutedStrong,
  },
});
