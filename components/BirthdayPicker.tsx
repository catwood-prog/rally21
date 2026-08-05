import { StyleSheet, Text, TextInput, View } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { colors, scaledLineHeight } from '@/constants/theme';
import { BIRTHDAY_YEAR_MIN, daysInMonth, maxBirthdayYear, MONTHS } from '@/lib/birthday';

export type BirthdayValue = { month: number | null; day: number | null; year: number | null };

/** BD1 — a controlled, fully-optional birthday picker shared by onboarding
 * and settings.
 *
 * WB1 job 2 (Cat's ruling, 3 Aug, variant B of
 * Rally21-Profile-Birthday-Mockups.html): the twelve month chips are GONE
 * and the block is three labelled typed boxes on one row — DAY, MONTH,
 * YEAR (OPTIONAL). Two things were wrong with the chip grid on a fresh
 * account's first screen: fifteen controls for a field most sign-ups skip,
 * and a chip row that dominated the profile screen above the one button
 * that matters.
 *
 * WHY LABELLED BOXES AND NOT A 00/00/0000 MASK, which is the obvious
 * shrink: this cohort is UK and US, so "03/04" is two different birthdays
 * depending on who typed it, and this field feeds PUBLIC wall
 * celebrations — the wrong day is a wrong day in front of someone's
 * circle. A label above each box removes the ambiguity that a slash mask
 * creates. The cost is stated in the mockup's own caption and accepted:
 * typing a month number is the least warm input on the screen.
 *
 * VALIDATION IS QUIET AND REAL. Every hint below states a range or asks
 * for the missing half of a pair; none of them scolds (warmth law), and
 * none of them fires on an empty box. isValidBirthday is still the gate at
 * save time and the DB check constraint is still the backstop — this only
 * says the same thing earlier and more kindly. Clearing both boxes
 * un-sets a birthday, which is what tapping a selected month used to do.
 *
 * STORAGE IS UNCHANGED: the same {month, day, year} triple the chips
 * wrote, to the same birth_month / birth_day / birth_year columns. */
export function BirthdayPicker({ value, onChange }: { value: BirthdayValue; onChange: (next: BirthdayValue) => void }) {
  const { month, day, year } = value;

  // One parser for all three boxes: digits only, capped at the box's own
  // width, and an empty box is null (never 0, which would read as a typed
  // value the DB constraint would then reject).
  const parse = (text: string, maxDigits: number): number | null => {
    const digits = text.replace(/[^0-9]/g, '').slice(0, maxDigits);
    return digits ? parseInt(digits, 10) : null;
  };

  const setDay = (text: string) => onChange({ month, day: parse(text, 2), year });
  const setMonth = (text: string) => onChange({ month: parse(text, 2), day, year });
  const setYear = (text: string) => onChange({ month, day, year: parse(text, 4) });

  // THE HINT, at most one at a time, in the order a person would meet
  // them: an out-of-range number first (the box in front of you is
  // wrong), then an impossible pair, then a half-finished pair. A
  // complete, valid birthday says nothing at all.
  const monthOutOfRange = month != null && (month < 1 || month > 12);
  const dayOutOfRange = day != null && (day < 1 || day > 31);
  const yearMax = maxBirthdayYear();
  const yearOutOfRange = year != null && (year < BIRTHDAY_YEAR_MIN || year > yearMax);
  const selectedMonth = month != null ? MONTHS.find((m) => m.value === month) : undefined;
  // Only meaningful once the month is a real month — Feb 31, not 13/31.
  const dayNotInMonth =
    !monthOutOfRange && !dayOutOfRange && month != null && day != null && day > daysInMonth(month);

  const hint = monthOutOfRange
    ? STRINGS.birthdayMonthOutOfRange
    : dayOutOfRange
      ? STRINGS.birthdayDayOutOfRange
      : yearOutOfRange
        ? STRINGS.birthdayYearOutOfRange(BIRTHDAY_YEAR_MIN, yearMax)
        : dayNotInMonth
          ? STRINGS.birthdayDayNotInMonth(selectedMonth?.full ?? '', daysInMonth(month as number))
          : month == null && day != null
            ? STRINGS.birthdayPickMonthFirst
            : month != null && day == null
              ? STRINGS.birthdayAddDayToo
              : null;

  return (
    <View>
      {/* The row is the mockup's `trio`: three equal columns, so the boxes
          stay side by side at 390px and share the extra width on desktop
          rather than one of them growing. Each column is flex: 1 with the
          label above its own box, so a label that wraps at large Dynamic
          Type pushes its own box down and never the neighbour's. */}
      <View style={styles.trio}>
        <View style={styles.field}>
          <Text style={styles.subLabel}>{STRINGS.birthdayDaySubLabel}</Text>
          <TextInput
            style={styles.numberInput}
            placeholder={STRINGS.birthdayDayPlaceholder}
            placeholderTextColor={colors.muted}
            value={day != null ? String(day) : ''}
            onChangeText={setDay}
            keyboardType="number-pad"
            maxLength={2}
            accessibilityLabel={STRINGS.birthdayDaySubLabel}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.subLabel}>{STRINGS.birthdayMonthSubLabel}</Text>
          <TextInput
            style={styles.numberInput}
            placeholder={STRINGS.birthdayMonthPlaceholder}
            placeholderTextColor={colors.muted}
            value={month != null ? String(month) : ''}
            onChangeText={setMonth}
            keyboardType="number-pad"
            maxLength={2}
            accessibilityLabel={STRINGS.birthdayMonthSubLabel}
          />
        </View>
        <View style={[styles.field, styles.yearField]}>
          <Text style={styles.subLabel}>{STRINGS.birthdayYearSubLabel}</Text>
          <TextInput
            style={styles.numberInput}
            placeholder={STRINGS.birthdayYearPlaceholder}
            placeholderTextColor={colors.muted}
            value={year != null ? String(year) : ''}
            onChangeText={setYear}
            keyboardType="number-pad"
            maxLength={4}
            accessibilityLabel={STRINGS.birthdayYearSubLabel}
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
    color: colors.mutedStrong,
    // OD1 job 17c's rule: a wrapping label needs a scaled line height, and
    // "YEAR (OPTIONAL)" is the one here that wraps first.
    lineHeight: scaledLineHeight(15),
    marginBottom: 8,
  },
  trio: {
    flexDirection: 'row',
    gap: 10,
    // BOTTOM-aligned, so the three boxes sit on one line even if a label
    // above one of them wraps. Measured at 390px: with flex-start and the
    // year column at 1, "YEAR (OPTIONAL)" wrapped to two lines and pushed
    // its box 15px below the other two — a visibly ragged row. The column
    // width below is the real fix; this is the belt for a wrap at large
    // Dynamic Type, where the boxes still have to read as a row.
    alignItems: 'flex-end',
  },
  field: {
    flex: 1,
  },
  // The year box holds four digits to the others' two, and its label is
  // the longest of the three. 1.4 is what makes "YEAR (OPTIONAL)" fit on
  // one line at 390px, and it gives "e.g. 1990" room it was short of.
  yearField: {
    flex: 1.4,
  },
  numberInput: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    // Horizontal padding is smaller than the old 14 because three boxes
    // now share a 390px row; the vertical padding (and so the tap target)
    // is unchanged.
    paddingVertical: 14,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.ink,
    // The old fixed-width day/year boxes are gone — flex: 1 on the column
    // above sizes these, which is what lets the row survive a wider
    // desktop viewport without a gap opening at its right edge.
    width: '100%',
  },
  hint: {
    fontSize: 12.5,
    color: colors.mutedStrong,
    fontStyle: 'italic',
    lineHeight: scaledLineHeight(18),
    marginTop: 8,
  },
});
