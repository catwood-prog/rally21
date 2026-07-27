import { StyleProp, StyleSheet, Text, TextInput, TouchableOpacity, View, ViewStyle } from 'react-native';

import { MicTextInput } from '@/components/MicTextInput';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
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
      <Text style={circleFormStyles.label}>{STRINGS.circleNameLabel}</Text>
      <Text style={circleFormStyles.helperText}>{STRINGS.circleNameHelper}</Text>
      <MicTextInput
        style={circleFormStyles.input}
        placeholder={STRINGS.circleNamePlaceholder}
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
      <Text style={circleFormStyles.label}>{STRINGS.resourceLinkLabel}</Text>
      <TextInput
        style={circleFormStyles.input}
        placeholder={STRINGS.resourceLinkPlaceholder}
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

// RF1 job 1c — the journey ladder's first four rungs. 21 is always the
// highlighted one here: this strip only ever renders at commitment,
// before a circle exists, so there is no "current" milestone to mark.
const FIRST_RALLY_MILESTONES = [21, 50, 100, 365];

/** RF1 job 1 — the commitment frame: header + supporting line + a quiet
 * milestone strip (21 highlighted gold). ONE shared component so
 * solo-setup and start-circle can never read differently; static, no
 * animation, no new deps. */
export function FirstRallyStrip({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Text style={circleFormStyles.firstRallyHeader}>{STRINGS.firstRallyHeader}</Text>
      <Text style={circleFormStyles.firstRallySupportingLine}>{STRINGS.firstRallySupportingLine}</Text>
      <MilestoneStrip />
    </View>
  );
}

/**
 * RF1 job 3j's ladder strip, as a VARIANT of the one above rather than a
 * fork — Cat's instruction was explicit that the two must never drift.
 *
 * `reached` marks every stop the person has passed with a green ✓, and
 * `next` is drawn gold and ~70% larger (29 vs 13px in the mockup) so the
 * eye lands on where they are going, not where they have been. With no
 * props it is the commitment-time strip: nothing reached, 21 highlighted,
 * which is exactly what FirstRallyStrip rendered before this split.
 *
 * PA2 — the numbers are PRACTICE COUNTS now, not calendar days.
 */
export function MilestoneStrip({
  reached,
  next,
  style,
}: {
  reached?: number[];
  next?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reachedSet = new Set(reached ?? []);
  // No `next` given = the pre-circle commitment frame, where 21 is the
  // one to look at because there is no progress to mark yet.
  const highlighted = next ?? 21;
  return (
    <View style={[circleFormStyles.milestoneRow, style]}>
      {FIRST_RALLY_MILESTONES.map((n, i) => (
        <View key={n} style={circleFormStyles.milestoneItem}>
          <Text
            style={[
              circleFormStyles.milestoneNumber,
              n === highlighted && circleFormStyles.milestoneNumberActive,
              reachedSet.has(n) && circleFormStyles.milestoneNumberReached,
              n === highlighted && !!next && circleFormStyles.milestoneNumberNext,
            ]}
          >
            {reachedSet.has(n) ? `${n} ✓` : n}
          </Text>
          {i < FIRST_RALLY_MILESTONES.length - 1 && <Text style={circleFormStyles.milestoneDot}>·</Text>}
        </View>
      ))}
    </View>
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
    color: colors.greenText,
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
  // RF1 job 1 — the first-rally commitment frame.
  firstRallyHeader: {
    fontFamily: FONT_HEADER,
    fontSize: 15,
    fontWeight: '800',
    color: colors.ink,
  },
  firstRallySupportingLine: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 2,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  milestoneItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  milestoneNumber: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.muted,
  },
  milestoneNumberActive: {
    fontWeight: '800',
    color: colors.ink,
  },
  // 3j — a stop already passed. greenText, never colors.green: green is a
  // FILL colour and fails contrast as text (OD1 job 10).
  milestoneNumberReached: {
    fontWeight: '800',
    color: colors.greenText,
  },
  // 3j — the stop being rallied toward, ~70% larger than the rest
  // (mockup 29 vs 13; 11.5 → 19.5 here, the same ratio at this strip's
  // scale). SIZE carries the emphasis.
  //
  // NEEDS-CAT, AND DELIBERATELY NOT RESOLVED HERE: she ruled this number
  // GOLD. `colors.gold` as TEXT measures 1.41:1 on bg — it fails the
  // 4.5:1 normal-text bar AND the 3:1 large-text bar, so CLAUDE.md's
  // colour law ("if it is text, it never takes colors.green or
  // colors.gold") forbids it outright, and there is no goldText in the
  // palette to reach for. Rather than invent a palette entry or ship a
  // number nobody can read, this renders ink at her ruled SIZE. Her
  // gold ruling stands unbuilt and is listed in the handoff, next to
  // the display-accent contrast question CLAUDE.md already parks with
  // her.
  milestoneNumberNext: {
    fontSize: 19.5,
    fontWeight: '800',
    color: colors.ink,
  },
  milestoneDot: {
    fontSize: 11.5,
    color: colors.muted,
    marginHorizontal: 6,
  },
});
