import { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { TimeOfDayPicker } from '@/components/TimeOfDayPicker';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, chipShape, chipTextShape, colors, scaledLineHeight } from '@/constants/theme';
import { formatTimeForDisplay, PREFILL_FALLBACK_TIME } from '@/lib/alarmReminder';

export type RemindersAskAlarmChoice = { enabled: boolean; time: string | null };

/** RM1 (13 July) — the reminders ask (mockup screen 6, rev-7): "full" is
 * the onboarding step shown once between profile and circle-setup;
 * "compact" is the one-time dismissible Today card for existing users.
 * Both render the identical headline/body/CTA copy so the moment reads
 * the same regardless of which surface a given account sees it on.
 *
 * AL1 job 4 (30 July) — the personal practice time rides THIS ask rather
 * than getting an onboarding step of its own, because notifications
 * should be one conversation, not two, and circle setup would re-ask on
 * the second circle a question already answered. Cat's earlier "set at
 * circle setup, edit in settings" answer was given while the time was
 * still per-circle; the user-level ruling supersedes it.
 *
 * The row is NATIVE-ONLY and starts OFF, so "turn on reminders" saves the
 * personal reminder only if the person actually asked for it — the app's
 * own reminders (nudge + digest) still turn on exactly as they did
 * before, on both platforms. Both variants carry it, because they are one
 * component precisely so they can never drift apart. */
export function RemindersAskCard({
  variant,
  onTurnOn,
  onMaybeLater,
  alarmPrefillTime,
  alarmPrefilled = false,
}: {
  variant: 'full' | 'compact';
  onTurnOn: (alarm: RemindersAskAlarmChoice) => void;
  onMaybeLater: () => void;
  /** Where the time picker opens — the prefill rule's answer, resolved by
   * the parent (which knows the account) rather than here. */
  alarmPrefillTime?: string;
  /** True when that time came from every circle AGREEING, rather than
   * from the 08:00 no-guess fallback. Only then is there anything honest
   * to say about why we started them there. */
  alarmPrefilled?: boolean;
}) {
  const compact = variant === 'compact';
  const [alarmOn, setAlarmOn] = useState(false);
  const [alarmTime, setAlarmTime] = useState(alarmPrefillTime ?? PREFILL_FALLBACK_TIME);
  const prefillNoteTime = alarmPrefilled ? formatTimeForDisplay(alarmTime) : null;

  return (
    <View style={compact ? styles.compactWrap : styles.fullWrap}>
      <Text style={styles.bell}>🔔</Text>
      <Text style={[styles.title, compact && styles.titleCompact]}>
        {STRINGS.remindersAskTitleLead}
        <Text style={styles.titleAccent}>{STRINGS.remindersAskTitleAccent}</Text>
        {STRINGS.remindersAskTitleTrail}
      </Text>
      <Text style={styles.body}>{STRINGS.remindersAskBody}</Text>

      {/* WEB HIDES THIS ENTIRELY (AL1 job 4): local scheduled
          notifications are native-only, so on web the feature does not
          exist rather than existing-but-broken. Web keeps exactly the
          card it had before this section. */}
      {Platform.OS !== 'web' && (
        <View style={styles.alarmBlock}>
          <TouchableOpacity style={styles.alarmRow} onPress={() => setAlarmOn((on) => !on)}>
            <Text style={styles.alarmRowLabel}>{STRINGS.remindersAskAlarmRowLabel}</Text>
            <View style={[styles.alarmPill, alarmOn && styles.alarmPillOn]}>
              <Text style={[styles.alarmPillText, alarmOn && styles.alarmPillTextOn]}>
                {alarmOn ? 'on' : 'off'}
              </Text>
            </View>
          </TouchableOpacity>

          {alarmOn && (
            <View style={styles.alarmPicker}>
              {prefillNoteTime && (
                <Text style={styles.alarmPrefillNote}>{STRINGS.alarmPrefillNote(prefillNoteTime)}</Text>
              )}
              <TimeOfDayPicker value={alarmTime} onChange={setAlarmTime} />
            </View>
          )}
        </View>
      )}

      <TouchableOpacity
        style={styles.cta}
        onPress={() => onTurnOn({ enabled: alarmOn, time: alarmOn ? alarmTime : null })}
      >
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
  // AL1 — stretched, because both wraps centre their children and the
  // picker's chip rows need the full content width to read as rows rather
  // than as a centred cluster.
  alarmBlock: {
    alignSelf: 'stretch',
    marginBottom: 20,
  },
  alarmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  alarmRowLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: scaledLineHeight(19),
  },
  // The settings prefPill shape, kept local rather than exported: this
  // card ships one pill and settings ships eight, and a shared pill
  // component is a bigger change than AL1 owns.
  alarmPill: {
    ...chipShape,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  alarmPillOn: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  alarmPillText: {
    ...chipTextShape,
    color: colors.mutedStrong,
  },
  alarmPillTextOn: {
    color: '#fff',
  },
  alarmPicker: {
    marginTop: 14,
  },
  alarmPrefillNote: {
    fontSize: 12.5,
    color: colors.mutedStrong,
    lineHeight: scaledLineHeight(18),
    marginBottom: 12,
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
