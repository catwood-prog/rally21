import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { CATEGORIES } from '@/constants/practices';
import { STRINGS } from '@/constants/strings';
import { chipShape, chipTextShape, colors } from '@/constants/theme';
import {
  classifyPracticeName,
  domainDisplay,
  getPracticeType,
  PracticeDomain,
  PracticeTypeKey,
  typesForDomain,
} from '@/lib/practiceTaxonomy';

export type PracticeTypeSelection = { domain: PracticeDomain; type: PracticeTypeKey };

/**
 * PT1 guided creation (the spec's flip): don't ask people to categorise —
 * infer from what they typed and let them correct. While the person is
 * typing, the deterministic classifier keeps one editable chip line in
 * sync ("Learn · Read — sound right? tap to change"); tapping it opens
 * the 6-domain → type picker. The moment they pick by hand, their choice
 * wins and the classifier stops overriding it. A name matching nothing
 * shows the picker with warm copy — two taps, never a blocker, no LLM.
 *
 * Shared by create-circle's custom form and my-practices' form so the
 * two creation paths can't drift (and so neither can leak a browse chip
 * into the category — the selection here is the ONLY source).
 */
export function PracticeTypePicker({
  name,
  value,
  onChange,
  initiallyPicked = false,
}: {
  name: string;
  value: PracticeTypeSelection | null;
  onChange: (value: PracticeTypeSelection | null) => void;
  /** Edit mode: the existing saved labels count as a human choice — a
   * name tweak must not silently recategorise an existing practice. */
  initiallyPicked?: boolean;
}) {
  const userPicked = useRef(initiallyPicked);
  const [expanded, setExpanded] = useState(false);
  const [activeDomain, setActiveDomain] = useState<PracticeDomain | null>(value?.domain ?? null);

  useEffect(() => {
    if (userPicked.current) return;
    const suggestion = classifyPracticeName(name);
    onChange(suggestion ? { domain: suggestion.domain, type: suggestion.type } : null);
    if (suggestion) setActiveDomain(suggestion.domain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const pick = (domain: PracticeDomain, type: PracticeTypeKey) => {
    userPicked.current = true;
    onChange({ domain, type });
    setExpanded(false);
  };

  const showPicker = expanded || !value;

  return (
    <View style={styles.wrap}>
      {value && !showPicker && (
        <View style={styles.suggestRow}>
          <TouchableOpacity
            style={[styles.chip, styles.chipSelected]}
            onPress={() => {
              setActiveDomain(value.domain);
              setExpanded(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${domainDisplay(value.domain)} · ${getPracticeType(value.type)?.display}. ${STRINGS.practiceTypeSoundRight}`}
          >
            <Text style={[styles.chipText, styles.chipTextSelected]}>
              {domainDisplay(value.domain)} · {getPracticeType(value.type)?.display}
            </Text>
          </TouchableOpacity>
          <Text style={styles.soundRight}>{STRINGS.practiceTypeSoundRight}</Text>
        </View>
      )}

      {showPicker && (
        <View>
          <Text style={styles.prompt}>
            {value ? STRINGS.practiceTypePickDomain : STRINGS.practiceTypePickPrompt}
          </Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((category) => {
              const active = category.key === activeDomain;
              return (
                <TouchableOpacity
                  key={category.key}
                  style={[styles.chip, active && styles.chipSelected]}
                  onPress={() => setActiveDomain(category.key)}
                  accessibilityRole="button"
                  accessibilityLabel={category.label}
                >
                  <Text style={[styles.chipText, active && styles.chipTextSelected]}>
                    {category.emoji} {category.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {activeDomain && (
            <>
              <Text style={styles.prompt}>{STRINGS.practiceTypePickType}</Text>
              <View style={styles.chipRow}>
                {typesForDomain(activeDomain).map((t) => {
                  const active = value?.type === t.key;
                  return (
                    <TouchableOpacity
                      key={t.key}
                      style={[styles.chip, active && styles.chipSelected]}
                      onPress={() => pick(t.domain, t.key)}
                      accessibilityRole="button"
                      accessibilityLabel={t.display}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextSelected]}>
                        {t.display}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 10,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  soundRight: {
    fontSize: 11.5,
    color: colors.muted,
  },
  prompt: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  chip: {
    ...chipShape,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipSelected: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.green,
  },
  chipText: {
    ...chipTextShape,
    color: colors.muted,
  },
  chipTextSelected: {
    color: colors.green,
  },
});
