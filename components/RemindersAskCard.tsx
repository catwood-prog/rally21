import { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { TimeOfDayPicker } from '@/components/TimeOfDayPicker';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, chipShape, chipTextShape, colors, scaledLineHeight } from '@/constants/theme';
import { formatTimeForDisplay, PREFILL_FALLBACK_TIME } from '@/lib/alarmReminder';

export type RemindersAskAlarmChoice = { enabled: boolean; time: string | null };

/** WB1 job 1a — whether the one-time settings pointer rides the native
 * confirm. PROPOSED: Cat rules the wording AND whether it ships at all,
 * so it is one named constant rather than an expression threaded through
 * the render, and turning it off is a one-word edit that leaves the rest
 * of the beat exactly as it is. */
const SHOW_TIME_POINTER_WHEN_ROW_LEFT_OFF = true;

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
 * component precisely so they can never drift apart.
 *
 * WB1 job 1a (4 Aug) — YES NOW GETS AN ANSWER. The card swaps in place to
 * a one-line confirm naming what turned on, instead of writing the prefs
 * and vanishing. Two details that are load-bearing:
 *
 *  - The confirm is driven by the PARENT'S SUCCESS, never by the tap.
 *    `onTurnOn` resolves true only when the writes landed, and a false
 *    resolution leaves the ask exactly where it was — today.tsx's failure
 *    path shows its own error line, and a confirm on top of that would be
 *    the card claiming something the database refused.
 *  - The line is PLATFORM-SPLIT (see the strings): web has no local
 *    scheduled reminder at all, so its yes turns on the email nudge and
 *    digest and says so.
 *
 * Both variants swap, again so they cannot drift. The difference is what
 * follows: the compact Today card's confirm is terminal for the visit,
 * while the onboarding step passes `onContinue` and the confirm carries
 * the button that moves the flow on. */
export function RemindersAskCard({
  variant,
  onTurnOn,
  onMaybeLater,
  onContinue,
  alarmPrefillTime,
  alarmPrefilled = false,
}: {
  variant: 'full' | 'compact';
  /** Resolves TRUE when the preferences actually saved. Typed as a
   * required promise rather than `void | Promise<...>` on purpose: an
   * accidental void return would be falsy, and the card would silently
   * never confirm. */
  onTurnOn: (alarm: RemindersAskAlarmChoice) => Promise<boolean>;
  onMaybeLater: () => void;
  /** Onboarding only — what the confirm's button does. Omitted on Today,
   * where the confirm simply sits until the next visit. */
  onContinue?: () => void;
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
  const [isTurningOn, setIsTurningOn] = useState(false);
  /** WB1 job 1a — what the confirm should say, captured at the moment the
   * writes landed. Null means the ask is still the ask. */
  const [confirmed, setConfirmed] = useState<RemindersAskAlarmChoice | null>(null);
  const prefillNoteTime = alarmPrefilled ? formatTimeForDisplay(alarmTime) : null;

  const handleTurnOn = async () => {
    if (isTurningOn) return;
    const choice: RemindersAskAlarmChoice = { enabled: alarmOn, time: alarmOn ? alarmTime : null };
    setIsTurningOn(true);
    try {
      const saved = await onTurnOn(choice);
      // Only a landed write earns the confirm. On false the parent has
      // already said what went wrong; the ask stays put so the person can
      // try again rather than being told it worked.
      if (saved) setConfirmed(choice);
    } finally {
      setIsTurningOn(false);
    }
  };

  if (confirmed) {
    // The confirm inherits the ask's own wrap, so it swaps IN PLACE: the
    // card does not resize or move under the finger that just tapped it.
    const showTimePointer =
      Platform.OS !== 'web' && !confirmed.enabled && SHOW_TIME_POINTER_WHEN_ROW_LEFT_OFF;
    // formatTimeForDisplay returns null for anything it cannot parse, and
    // that null is respected rather than papered over: the line names a
    // time only when there is a real time to name, and otherwise says the
    // plain native thing. A confirm that printed a broken time would be
    // worse than the silence this section exists to fix.
    const confirmedTime = confirmed.enabled ? formatTimeForDisplay(confirmed.time) : null;
    const line =
      Platform.OS === 'web'
        ? STRINGS.remindersConfirmWeb
        : confirmedTime
          ? STRINGS.remindersConfirmNativeWithTime(confirmedTime)
          : STRINGS.remindersConfirmNative;
    return (
      <View style={compact ? styles.compactWrap : styles.fullWrap}>
        <Text style={styles.bell}>🔔</Text>
        <Text style={styles.confirmLine}>{line}</Text>
        {showTimePointer && (
          <Text style={styles.confirmPointer}>{STRINGS.remindersConfirmTimePointer}</Text>
        )}
        {onContinue && (
          <TouchableOpacity style={[styles.cta, styles.confirmCta]} onPress={onContinue}>
            <Text style={styles.ctaText}>{STRINGS.remindersConfirmContinueCta}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

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

      <TouchableOpacity style={styles.cta} onPress={handleTurnOn} disabled={isTurningOn}>
        <Text style={styles.ctaText}>{STRINGS.remindersAskCta}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onMaybeLater} disabled={isTurningOn}>
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
    color: colors.onFill,
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
  // WB1 job 1a — the confirm's register is YD1's honest toast, not a
  // celebration: it states what saved, quietly, in the body's own size and
  // colour. Ink rather than mutedStrong because it is the only sentence on
  // the card now and it is the answer to a question the person just asked.
  confirmLine: {
    fontSize: 13,
    color: colors.ink,
    lineHeight: scaledLineHeight(19),
    textAlign: 'center',
    marginTop: 10,
  },
  confirmPointer: {
    fontSize: 12.5,
    color: colors.mutedStrong,
    lineHeight: scaledLineHeight(18),
    textAlign: 'center',
    marginTop: 10,
  },
  // The confirm's continue button reuses `cta`'s shape and weight, so the
  // onboarding step's one control looks the same as it did a tap ago, and
  // adds only the top gap the ask got from its body's margin. Kept
  // separate rather than folded into `cta` so the ASK's spacing is
  // untouched by this section.
  confirmCta: {
    marginTop: 18,
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
    color: colors.onFill,
  },
  maybeLater: {
    marginTop: 14,
    fontSize: 12,
    fontWeight: '600',
    color: colors.mutedStrong,
  },
});
