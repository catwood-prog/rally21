import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { chipShape, chipTextShape, colors } from '@/constants/theme';
import { formatTimeOfDay, parseTimeOfDay } from '@/lib/alarmReminder';

/**
 * AL1 job 4 — a real time of day, chosen in pure JS.
 *
 * Cat's ruling is "an actual time for their practice", which the existing
 * four-chip rows (settings' nudge-time / quiet-hours options) cannot
 * express — those are coarse buckets, and one of them, notification_prefs
 * .nudge_time, is a different setting entirely. The obvious answer, a real
 * spinner, is @react-native-community/datetimepicker: a NATIVE dependency,
 * which would move the fingerprint and push this whole section into build
 * 10 alongside AL1 phase 2. AL1 phase 1 is OTA-servable by ruling, so the
 * picker is built from the chip idiom the app already has instead.
 *
 * Shape: all 24 hours in two labelled groups of 12 (the BirthdayPicker's
 * twelve-month row is the precedent for that density at 390px), then
 * quarter-hour minutes. 96 real times, two taps, no keyboard, and no hour
 * quietly ruled out — someone who practises at 5am or 11pm is unusual, not
 * unwelcome, and silently cropping the range would have been a product
 * decision made by a build session.
 */

const MORNING_HOURS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AFTERNOON_HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const MINUTES = [0, 15, 30, 45];

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}${suffix}`;
}

function minuteLabel(minute: number): string {
  return `:${String(minute).padStart(2, '0')}`;
}

export function TimeOfDayPicker({
  value,
  onChange,
}: {
  /** "HH:MM:SS" — always set, since the caller only renders this once the
   * reminder is on and the DB constraint makes "on with no time"
   * unrepresentable. */
  value: string;
  onChange: (next: string) => void;
}) {
  // A value that will not parse falls back to the picker's own opening
  // position rather than leaving every chip unselected: an unreadable
  // stored time should look like a time waiting to be confirmed, not like
  // a broken screen.
  const parsed = parseTimeOfDay(value) ?? { hour: 8, minute: 0 };
  // The stored minute may be off-grid (a future per-membership override,
  // or a hand-edited row) — snap the SELECTION display down to the chip
  // it belongs to without rewriting what is stored until a real tap.
  const selectedMinuteChip = MINUTES.reduce(
    (best, m) => (m <= parsed.minute ? m : best),
    MINUTES[0]
  );

  const renderHourRow = (hours: number[]) => (
    <View style={styles.chipRow}>
      {hours.map((hour) => {
        const selected = hour === parsed.hour;
        return (
          <TouchableOpacity
            key={hour}
            style={[styles.chip, selected && styles.chipSelected]}
            onPress={() => onChange(formatTimeOfDay(hour, parsed.minute))}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{hourLabel(hour)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <View>
      <Text style={styles.subLabel}>{STRINGS.alarmTimeMorningLabel}</Text>
      {renderHourRow(MORNING_HOURS)}

      <Text style={[styles.subLabel, styles.laterLabel]}>{STRINGS.alarmTimeAfternoonLabel}</Text>
      {renderHourRow(AFTERNOON_HOURS)}

      <Text style={[styles.subLabel, styles.laterLabel]}>{STRINGS.alarmTimeMinuteLabel}</Text>
      <View style={styles.chipRow}>
        {MINUTES.map((minute) => {
          const selected = minute === selectedMinuteChip;
          return (
            <TouchableOpacity
              key={minute}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => onChange(formatTimeOfDay(parsed.hour, minute))}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{minuteLabel(minute)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  subLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.mutedStrong,
    marginBottom: 8,
  },
  laterLabel: {
    marginTop: 14,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    ...chipShape,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  chipSelected: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  chipText: {
    ...chipTextShape,
    color: colors.ink,
  },
  chipTextSelected: {
    color: colors.onFill,
  },
});
