import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { cardShadow, chipShape, chipTextShape, colors, scaledLineHeight } from '@/constants/theme';

/**
 * SK1 job 4 — the one "daily reflections" toggle, wherever it renders.
 *
 * Cat's ruling (23 July): the way back in lives ON the page a person
 * walks into (journal, private map, ask Rally), not only in settings —
 * so this is deliberately ONE component with two skins rather than four
 * hand-built rows that could drift apart:
 *
 *  - `inline` (the mockup's green-outlined row) for the curiosity states
 *    on journal / private map / ask Rally, where it's the invitation.
 *  - `settings` (the plain prefRow surface) for Settings, which is home
 *    base and already has a column of rows in exactly that treatment.
 *
 * The on/off pill is Settings' own established affordance (app sounds,
 * celebrate birthday, nudges), not a new switch — the mockup draws a
 * knob, but one toggle vocabulary across the app beats matching a
 * drawing, and this row sits directly beside those pills in Settings.
 */
export function ReflectionsToggleRow({
  value,
  onToggle,
  variant = 'inline',
  disabled,
}: {
  /** true = reflections ON (i.e. NOT opted out). */
  value: boolean;
  onToggle: () => void;
  variant?: 'inline' | 'settings';
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, variant === 'inline' ? styles.rowInline : styles.rowSettings]}>
      <View style={styles.text}>
        <Text style={styles.label}>{STRINGS.reflectionsToggleLabel}</Text>
        <Text style={styles.helper}>{STRINGS.reflectionsToggleHelper}</Text>
      </View>
      <TouchableOpacity
        style={[styles.pill, value && styles.pillOn]}
        onPress={onToggle}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled: !!disabled }}
        accessibilityLabel={STRINGS.reflectionsToggleLabel}
      >
        <Text style={[styles.pillText, value && styles.pillTextOn]}>{value ? 'on' : 'off'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  // The mockup's invitation treatment: soft green fill, green outline —
  // the same "this is alive and available" register as the private badge.
  rowInline: {
    backgroundColor: colors.greenSoft,
    borderWidth: 1.5,
    borderColor: colors.green,
    marginTop: 16,
  },
  // Settings' own prefRow surface, so the row reads as one of the column
  // rather than a transplant.
  rowSettings: {
    backgroundColor: colors.card,
    ...cardShadow,
  },
  text: {
    flex: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  helper: {
    fontSize: 11.5,
    // YD1's lesson: a scaled line height, never a bare number — this
    // helper has to survive the largest accessibility text size.
    lineHeight: scaledLineHeight(16),
    color: colors.mutedStrong,
    marginTop: 2,
  },
  pill: {
    ...chipShape,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  pillOn: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  pillText: {
    ...chipTextShape,
    color: colors.mutedStrong,
  },
  pillTextOn: {
    color: '#fff',
  },
});
