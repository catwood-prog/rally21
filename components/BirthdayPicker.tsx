import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { chipShape, chipTextShape, colors } from '@/constants/theme';
import { daysInMonth, MONTHS } from '@/lib/birthday';

export type BirthdayValue = { month: number | null; day: number | null; year: number | null };

/** BD1 — a controlled, fully-optional birthday picker shared by onboarding
 * and settings. Month is chips; day and year are small matching numeric
 * fields (a real cohort user went looking for a day text box — redesigned
 * 8 July from the original bounded day chips). An impossible pair (Feb 31)
 * shows a quiet inline hint here and is rejected by isValidBirthday at
 * save time, mirroring the DB constraint. Tapping a selected month again
 * clears it, which is how someone un-sets a birthday. */
export function BirthdayPicker({ value, onChange }: { value: BirthdayValue; onChange: (next: BirthdayValue) => void }) {
  const { month, day, year } = value;

  const selectMonth = (m: number) => {
    if (m === month) {
      // toggle off — clearing the month clears the day too (they're a pair)
      onChange({ month: null, day: null, year });
      return;
    }
    onChange({ month: m, day, year });
  };

  const setDay = (text: string) => {
    const digits = text.replace(/[^0-9]/g, '').slice(0, 2);
    onChange({ month, day: digits ? parseInt(digits, 10) : null, year });
  };

  const setYear = (text: string) => {
    const digits = text.replace(/[^0-9]/g, '').slice(0, 4);
    onChange({ month, day, year: digits ? parseInt(digits, 10) : null });
  };

  // The one quiet hint line: a typed day that doesn't exist in the chosen
  // month, or a day given before any month is picked.
  const selectedMonth = month != null ? MONTHS.find((m) => m.value === month) : undefined;
  const dayTooBig = month != null && day != null && (day < 1 || day > daysInMonth(month));
  const dayWithoutMonth = month == null && day != null;
  const hint = dayTooBig
    ? STRINGS.birthdayDayNotInMonth(selectedMonth?.full ?? '', daysInMonth(month as number))
    : dayWithoutMonth
      ? STRINGS.birthdayPickMonthFirst
      : null;

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

      <View style={styles.fieldsRow}>
        <View>
          <Text style={styles.subLabel}>{STRINGS.birthdayDaySubLabel}</Text>
          <TextInput
            style={[styles.numberInput, styles.dayInput]}
            placeholder={STRINGS.birthdayDayPlaceholder}
            placeholderTextColor={colors.muted}
            value={day != null ? String(day) : ''}
            onChangeText={setDay}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
        <View>
          <Text style={styles.subLabel}>{STRINGS.birthdayYearSubLabel}</Text>
          <TextInput
            style={[styles.numberInput, styles.yearInput]}
            placeholder={STRINGS.birthdayYearPlaceholder}
            placeholderTextColor={colors.muted}
            value={year != null ? String(year) : ''}
            onChangeText={setYear}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>
      </View>

      {hint != null && <Text style={styles.hint}>{hint}</Text>}
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
    color: '#fff',
  },
  fieldsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 16,
  },
  numberInput: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: colors.ink,
  },
  dayInput: {
    width: 90,
  },
  yearInput: {
    width: 140,
  },
  hint: {
    fontSize: 12.5,
    color: colors.muted,
    fontStyle: 'italic',
    marginTop: 8,
  },
});
