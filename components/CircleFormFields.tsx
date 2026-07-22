import { StyleProp, StyleSheet, Text, TextInput, TouchableOpacity, View, ViewStyle } from 'react-native';

import { MicTextInput } from '@/components/MicTextInput';
import { STRINGS } from '@/constants/strings';
import { chipShape, chipTextShape, colors } from '@/constants/theme';

/** The circle form's shared fields — the CF2 setup screens
 * (onboarding/solo-setup.tsx, onboarding/start-circle.tsx) and edit
 * (edit-circle.tsx, EC1) render the same labels, inputs, and chips from
 * here so the forms can never drift (EC1's hard rule: one form
 * vocabulary, no second implementation). */

export const MAX_CIRCLE_NAME_LENGTH = 40;

export const TIME_OPTIONS = [
  { label: 'Morning', time: '08:00:00' },
  { label: 'Midday', time: '12:00:00' },
  { label: 'Evening', time: '18:00:00' },
  { label: 'Night', time: '21:00:00' },
];

type FieldProps = {
  value: string;
  onChange: (value: string) => void;
  style?: StyleProp<ViewStyle>;
};

export function CircleNameField({ value, onChange, style }: FieldProps) {
  return (
    <View style={style}>
      <Text style={circleFormStyles.label}>name your circle</Text>
      <Text style={circleFormStyles.helperText}>{STRINGS.circleNameHelper}</Text>
      <MicTextInput
        style={circleFormStyles.input}
        placeholder="your circle's name"
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChange}
        autoCorrect={false}
        maxLength={MAX_CIRCLE_NAME_LENGTH}
      />
    </View>
  );
}

export function TimeOfDayField({ value, onChange, style }: FieldProps) {
  return (
    <View style={style}>
      <Text style={circleFormStyles.label}>time of day</Text>
      <View style={circleFormStyles.chipRow}>
        {TIME_OPTIONS.map((option) => {
          const selected = option.time === value;
          return (
            <TouchableOpacity
              key={option.time}
              style={[circleFormStyles.chip, selected && circleFormStyles.chipSelected]}
              onPress={() => onChange(option.time)}
            >
              <Text style={[circleFormStyles.chipText, selected && circleFormStyles.chipTextSelected]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export function ResourceLinkField({ value, onChange, style }: FieldProps) {
  return (
    <View style={style}>
      <Text style={circleFormStyles.label}>add a link (optional)</Text>
      <TextInput
        style={circleFormStyles.input}
        placeholder="a video, article, or playlist your circle follows"
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChange}
        autoCorrect={false}
        autoCapitalize="none"
        keyboardType="url"
      />
    </View>
  );
}

/** PI1 — the collapsed "add practice instructions (optional)" action that
 * replaces the inline link field on the setup + edit screens. Tapping it
 * opens the practice-instructions editor (its own screen, which now holds
 * the routine text AND the relocated resource link). `hasContent` is true
 * once either the instructions or the link is set, so the row can read
 * back what's there instead of always inviting. Never a required step. */
export function PracticeInstructionsField({
  hasContent,
  onPress,
  style,
}: {
  hasContent: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      style={[circleFormStyles.instructionsAction, hasContent && circleFormStyles.instructionsActionSet, style]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={circleFormStyles.instructionsActionTextWrap}>
        <Text
          style={[
            circleFormStyles.instructionsActionText,
            hasContent && circleFormStyles.instructionsActionTextSet,
          ]}
        >
          {hasContent ? STRINGS.practiceInstructionsActionEdit : STRINGS.practiceInstructionsActionAdd}
        </Text>
        {hasContent && (
          <Text style={circleFormStyles.instructionsActionHint}>
            {STRINGS.practiceInstructionsActionEditHint}
          </Text>
        )}
      </View>
      <Text style={circleFormStyles.instructionsActionChevron}>›</Text>
    </TouchableOpacity>
  );
}

/** Exported for the fields the setup screens keep local (the solo
 * now/tomorrow chips, the duration input) and edit-circle's practice
 * inputs — same label, input, and chip vocabulary, one stylesheet. */
export const circleFormStyles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 8,
  },
  helperText: {
    fontSize: 12,
    color: colors.muted,
    marginTop: -4,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: colors.ink,
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
  // PI1 collapsed action — an invite when empty (dashed, muted, like the
  // circle screen's "+ add a link" prompt), a settled card once set.
  instructionsAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  instructionsActionSet: {
    borderStyle: 'solid',
    borderColor: colors.green,
  },
  instructionsActionTextWrap: {
    flex: 1,
  },
  instructionsActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
  },
  instructionsActionTextSet: {
    fontWeight: '700',
    color: colors.ink,
  },
  instructionsActionHint: {
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 2,
  },
  instructionsActionChevron: {
    fontSize: 22,
    fontWeight: '400',
    color: colors.muted,
    marginLeft: 10,
  },
});
