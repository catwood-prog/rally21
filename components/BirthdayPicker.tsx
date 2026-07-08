import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { chipShape, chipTextShape, colors } from '@/constants/theme';
import { daysInMonth, MONTHS } from '@/lib/birthday';

export type BirthdayValue = { month: number | null; day: number | null; year: number | null };

/** BD1 — a controlled, fully-optional birthday picker shared by onboarding
 * and settings. Month + day are chips (no invalid pair is selectable — the
 * day chips only go up to the selected month's max, so Feb 31 can't be
 * chosen); the year is a small optional numeric field. Tapping a selected
 * month or day again clears it, which is how someone un-sets a birthday. */
export function BirthdayPicker({ value, onChange }: { value: BirthdayValue; onChange: (next: BirthdayValue) => void }) {
  const { month, day, year } = value;

  const selectMonth = (m: number) => {
    if (m === month) {
      // toggle off — clearing the month clears the day too (they're a pair)
      onChange({ month: null, day: null, year });
      return;
    }
    // if the current day doesn't exist in the new month (e.g. 31 → Feb), drop it
    const nextDay = day != null && day > daysInMonth(m) ? null : day;
    onChange({ month: m, day: nextDay, year });
  };

  const selectDay = (d: number) => {
    onChange({ month, day: d === day ? null : d, year });
  };

  const setYear = (text: string) => {
    const digits = text.replace(/[^0-9]/g, '').slice(0, 4);
    onChange({ month, day, year: digits ? parseInt(digits, 10) : null });
  };

  const dayCount = month != null ? daysInMonth(month) : 0;

  return (
    <View>
      <Text style={styles.subLabel}>{STRINGS.birthdayMonthSubLabel}</Text>
      <View style={styles.chipRow}>
        {MONTHS.map((m) => {
          const selected = m.value === month;
          return (
            <TouchableOpacity
              key={m.value}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => selectMonth(m.value)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{m.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.subLabel, styles.subLabelSpaced]}>{STRINGS.birthdayDaySubLabel}</Text>
      {month == null ? (
        <Text style={styles.pickMonthHint}>{STRINGS.birthdayPickMonthFirst}</Text>
      ) : (
        <View style={styles.chipRow}>
          {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => {
            const selected = d === day;
            return (
              <TouchableOpacity
                key={d}
                style={[styles.dayChip, selected && styles.chipSelected]}
                onPress={() => selectDay(d)}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{d}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Text style={[styles.subLabel, styles.subLabelSpaced]}>{STRINGS.birthdayYearSubLabel}</Text>
      <TextInput
        style={styles.yearInput}
        placeholder={STRINGS.birthdayYearPlaceholder}
        placeholderTextColor={colors.muted}
        value={year != null ? String(year) : ''}
        onChangeText={setYear}
        keyboardType="number-pad"
        maxLength={4}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  subLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 8,
  },
  subLabelSpaced: {
    marginTop: 16,
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
  // Day chips are compact and fixed-width so 1–31 wraps into a tidy grid
  // at 390px rather than a ragged row.
  dayChip: {
    minWidth: 40,
    alignItems: 'center',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 10,
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
    color: '#fff',
  },
  pickMonthHint: {
    fontSize: 12.5,
    color: colors.muted,
    fontStyle: 'italic',
  },
  yearInput: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: colors.ink,
    width: 140,
  },
});
