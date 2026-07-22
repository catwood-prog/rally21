import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { KeyboardFriendlyScrollView } from '@/components/KeyboardFriendlyScrollView';
import { MicTextInput } from '@/components/MicTextInput';
import { MessageDialog } from '@/components/MessageDialog';
import { PracticeTypePicker, PracticeTypeSelection } from '@/components/PracticeTypePicker';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { createPractice, Practice } from '@/lib/circle-setup';

/**
 * CF2 screen 2 — "create a practice", a dedicated screen (the old
 * expanding tile inside browse is gone; creating an object is not a
 * browse result). PT1's classifier drives the suggestion card; a
 * low-confidence / no-match name leaves continue disabled until a type
 * is picked through the two-tap picker (5 domains → 19 types). The type
 * is required always; no category is ever sent — CF1's server derives
 * the shelf from the type, so the browse-filter contamination class is
 * structurally dead.
 *
 * Continue lands on the practice hub (or straight on solo setup when
 * SF1's go-solo intent rode in) — a just-created practice can't have
 * open circles, but the hub is still where "how do you want to
 * practise?" gets answered.
 */
export default function CreateAPractice() {
  const router = useRouter();
  // NAV1 job 0 — no AppHeader on pre-signed-in-chrome screens, but the
  // safe-area inset still applies.
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { solo, fromToday, wantKey, wantStatement, suggestedName } = useLocalSearchParams<{
    solo?: string;
    fromToday?: string;
    wantKey?: string;
    wantStatement?: string;
    suggestedName?: string;
  }>();
  const isSolo = solo === 'true';
  const isFromToday = fromToday === 'true';

  const [name, setName] = useState(suggestedName ?? '');
  const [duration, setDuration] = useState('');
  const [selection, setSelection] = useState<PracticeTypeSelection | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = !!name.trim() && !!selection;

  const handleContinue = async () => {
    if (!canContinue || !session?.user || !selection) return;
    setIsCreating(true);
    try {
      const minutes = duration.trim() ? parseInt(duration.trim(), 10) : null;
      const practice: Practice = await createPractice({
        name: name.trim(),
        practiceType: selection.type,
        durationMinutes: minutes && minutes > 0 ? minutes : null,
        createdBy: session.user.id,
      });
      router.replace({
        pathname: isSolo ? '/onboarding/solo-setup' : '/onboarding/practice-hub',
        params: {
          practiceId: practice.id,
          practiceKey: practice.key,
          practiceName: practice.name,
          practiceType: practice.practiceType,
          ...(practice.durationMinutes ? { defaultDuration: String(practice.durationMinutes) } : {}),
          // A brand-new custom is always private until a public circle
          // uses it (PT1's is_shared model) — the circle setup screen
          // uses this to raise its explicit share-flip confirm.
          privateCustom: 'true',
          ...(isSolo ? { solo: 'true' } : {}),
          ...(isFromToday ? { fromToday: 'true' } : {}),
          ...(wantKey ? { wantKey, wantStatement: wantStatement ?? '' } : {}),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save that — try again');
      setIsCreating(false);
    }
  };

  return (
    <KeyboardFriendlyScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 20 + insets.top }]}
    >
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity
        onPress={() =>
          router.canGoBack() ? router.back() : router.push('/onboarding/create-circle')
        }
      >
        <Text style={styles.back}>← back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{STRINGS.createPracticeTitle}</Text>

      <Text style={styles.label}>{STRINGS.practiceStepQuestion}</Text>
      <MicTextInput
        style={styles.input}
        placeholder="e.g. Walk 20 minutes"
        placeholderTextColor={colors.muted}
        value={name}
        onChangeText={setName}
        autoCorrect={false}
      />

      {/* The suggestion card: PT1's classifier chip with CF2's explicit
          provenance line — people should know Rally guessed from their
          own words, and that the guess is theirs to change. */}
      <View style={styles.groupingCard}>
        <Text style={styles.groupingLabel}>{STRINGS.suggestedGroupingLabel}</Text>
        <PracticeTypePicker name={name} value={selection} onChange={setSelection} />
        {!!selection && (
          <Text style={styles.provenance}>{STRINGS.suggestedGroupingProvenance}</Text>
        )}
      </View>

      <Text style={styles.label}>{STRINGS.durationLabel}</Text>
      <TextInput
        style={styles.input}
        placeholder="minutes"
        placeholderTextColor={colors.muted}
        value={duration}
        onChangeText={(text) => setDuration(text.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
      />

      <TouchableOpacity
        style={[styles.button, !canContinue && styles.buttonDisabled]}
        onPress={handleContinue}
        disabled={!canContinue || isCreating}
      >
        {isCreating ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>{STRINGS.createPracticeContinue}</Text>
        )}
      </TouchableOpacity>

      <MessageDialog
        visible={!!error}
        title="hmm"
        variant="error"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </KeyboardFriendlyScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  brandmark: {
    marginBottom: 14,
  },
  back: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 16,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 20,
    color: colors.ink,
    marginBottom: 18,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 13,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 16,
  },
  groupingCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    ...cardShadow,
  },
  groupingLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 8,
  },
  provenance: {
    fontSize: 11,
    color: colors.muted,
    fontStyle: 'italic',
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});
