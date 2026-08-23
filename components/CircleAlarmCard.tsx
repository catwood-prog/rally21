import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { cardShadow, chipShape, chipTextShape, colors, scaledLineHeight } from '@/constants/theme';
import { formatTimeForDisplay } from '@/lib/alarmReminder';
import {
  readCircleAlarm,
  setCircleAlarm,
  type SetCircleAlarmResult,
} from '@/lib/circleAlarm';
import { captureError } from '@/lib/sentry';
import { isAlarmKitAvailable } from '@/modules/rally-alarm-kit';

import { TimeOfDayPicker } from './TimeOfDayPicker';

/**
 * AK1 jobs 4, 6 and 7 — the per-circle alarm control.
 *
 * ITS OWN COMPONENT, not eighty lines inside circle.tsx, for two reasons:
 * circle.tsx is 2,700 lines and does not carry the membership id this
 * needs, and the toggle's whole job is a state machine (asking, scheduling,
 * refused, denied) that is far easier to reason about — and to test —
 * standing on its own.
 *
 * THE FENCE'S RENDER HALF (job 3). `isAlarmKitAvailable()` is false on web,
 * on Android and on any iPhone below iOS 26, and this returns null there.
 * The control does not draw, is not disabled, and is not explained: a
 * feature that exists-but-cannot-work is worse than one that simply is not
 * there (AL1 job 4's precedent, and settings.tsx's own web branch).
 *
 * THE OFF SWITCH IS AS FINDABLE AS THE ON SWITCH (Cat's job 6 constraint).
 * One row, state written on it, never nested behind a disclosure — because
 * an alarm that pierces Silent is the most aggressive surface in the app
 * and the way out of it must be the first thing you find.
 */
export function CircleAlarmCard({
  userId,
  circleId,
  circleName,
}: {
  userId: string;
  circleId: string;
  circleName: string;
}) {
  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  /** Job 7's two honest refusals. Cleared on every fresh attempt so a
   * stale line never sits under a toggle that has since succeeded. */
  const [refusal, setRefusal] = useState<'permission-denied' | 'refused-limit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const available = isAlarmKitAvailable();

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    readCircleAlarm(userId, circleId)
      .then((row) => {
        if (cancelled || !row) return;
        setMembershipId(row.membershipId);
        setEnabled(row.alarmEnabled);
        setTime(row.alarmTime);
      })
      .catch((e) => captureError(e, { op: 'readCircleAlarm', circleId }));
    return () => {
      cancelled = true;
    };
  }, [available, userId, circleId]);

  const apply = useCallback(
    async (next: { enabled: boolean; time: string | null }) => {
      if (!membershipId || isSaving) return;
      setIsSaving(true);
      setRefusal(null);
      setError(null);
      try {
        const res: SetCircleAlarmResult = await setCircleAlarm({
          membershipId,
          circleId,
          circleName,
          enabled: next.enabled,
          time: next.time,
        });
        // JOB 7, AT THE RENDER LAYER: the toggle follows the RESULT, never
        // the intent. `refused-limit` and `permission-denied` both leave it
        // OFF, because in both cases no alarm exists — and a toggle showing
        // "on" over an alarm that will never ring is exactly the trap this
        // section was written to keep shut.
        if (res.status === 'on') {
          setEnabled(true);
          setTime(next.time);
        } else if (res.status === 'off') {
          setEnabled(false);
          setTime(null);
        } else if (res.status === 'refused-limit' || res.status === 'permission-denied') {
          setEnabled(false);
          setRefusal(res.status);
        }
      } catch (e) {
        setEnabled(!next.enabled ? enabled : false);
        setError(e instanceof Error ? e.message : 'could not save that — try again');
        captureError(e, { op: 'setCircleAlarm', circleId });
      } finally {
        setIsSaving(false);
      }
    },
    [membershipId, isSaving, circleId, circleName, enabled]
  );

  if (!available || !membershipId) return null;

  const displayTime = formatTimeForDisplay(time);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>{STRINGS.circleAlarmToggleLabel}</Text>
          <Text style={styles.helper}>
            {enabled && displayTime
              ? STRINGS.circleAlarmToggleHelperOn(displayTime)
              : STRINGS.circleAlarmToggleHelperOff}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.pill, enabled && styles.pillOn]}
          onPress={() => apply({ enabled: !enabled, time: enabled ? null : (time ?? '08:00:00') })}
          disabled={isSaving}
          accessibilityRole="switch"
          accessibilityState={{ checked: enabled, disabled: isSaving }}
          accessibilityLabel={STRINGS.circleAlarmToggleLabel}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={colors.ink} />
          ) : (
            <Text style={[styles.pillText, enabled && styles.pillTextOn]}>
              {enabled ? 'on' : 'off'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* JOB 4 — a denial DEEP-LINKS to Settings rather than silently
          no-oping, which is PN1's law and the same shape AL1's own denied
          line already uses. */}
      {refusal === 'permission-denied' && (
        <TouchableOpacity onPress={() => Linking.openSettings()}>
          <Text style={[styles.helper, styles.refusalLine]}>
            {STRINGS.circleAlarmPermissionDenied}
          </Text>
        </TouchableOpacity>
      )}

      {/* JOB 7 — iOS would not hold another alarm. Says what happened,
          blames nobody, and names the one thing that makes room. */}
      {refusal === 'refused-limit' && (
        <Text style={[styles.helper, styles.refusalLine]}>{STRINGS.circleAlarmRefusedLimit}</Text>
      )}

      {error && <Text style={[styles.helper, styles.refusalLine]}>{error}</Text>}

      {enabled ? (
        <View style={styles.pickerSpacing}>
          <Text style={styles.pickerLabel}>{STRINGS.circleAlarmTimeLabel}</Text>
          <TimeOfDayPicker
            value={time ?? '08:00:00'}
            onChange={(next) => apply({ enabled: true, time: next })}
          />
        </View>
      ) : (
        <Text style={styles.emptyState}>{STRINGS.circleAlarmEmptyState}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Deliberately the same shape as settings.tsx's prefCard family rather
  // than a new look: this is a preference row, and someone who has met
  // AL1's reminder toggle in Settings should recognise this instantly.
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginTop: 16,
    ...cardShadow,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
  label: { fontSize: 13, fontWeight: '700', color: colors.ink },
  // YD1 — scaledLineHeight, never a bare number: at larger Dynamic Type
  // settings a fixed lineHeight clips the tail of a multi-line helper, and
  // both helpers here are longer than the away-pause line that first
  // exposed that on Cat's phone.
  helper: {
    fontSize: 11.5,
    color: colors.mutedStrong,
    lineHeight: scaledLineHeight(16),
    marginTop: 2,
  },
  refusalLine: { marginTop: 10, color: colors.errorRed },
  pill: {
    ...chipShape,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  pillOn: { backgroundColor: colors.green, borderColor: colors.green },
  pillText: { ...chipTextShape, color: colors.mutedStrong },
  pillTextOn: { color: colors.onFill },
  pickerSpacing: { marginTop: 14 },
  pickerLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.mutedStrong,
    marginBottom: 8,
  },
  emptyState: {
    fontSize: 11.5,
    color: colors.mutedStrong,
    lineHeight: scaledLineHeight(16),
    marginTop: 10,
  },
});
