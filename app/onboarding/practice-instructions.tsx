import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { KeyboardFriendlyScrollView } from '@/components/KeyboardFriendlyScrollView';
import { circleFormStyles, ResourceLinkField } from '@/components/CircleFormFields';
import { MessageDialog } from '@/components/MessageDialog';
import { MicTextInput } from '@/components/MicTextInput';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { seedInstructionsDraft, takeInstructionsDraft } from '@/lib/practiceInstructionsDraft';
import { isHttpUrl } from '@/lib/resourceLink';

const MAX_INSTRUCTIONS_LENGTH = 2000;

/**
 * PI1 — the practice-instructions editor: its own screen, reached from the
 * collapsed action on onboarding/start-circle, onboarding/solo-setup, and
 * (app)/edit-circle. It edits a DRAFT (the circle may not exist yet on the
 * two create screens), seeded and handed back through
 * lib/practiceInstructionsDraft — never writes to the database itself, so
 * one editor serves create and edit alike. Lives in /onboarding/ because
 * that's the one group reachable both mid-first-circle-onboarding (where
 * the create screens live) and from the settled app (edit-circle pushes
 * across to it; the onboarding layout only requires a session).
 *
 * Holds BOTH the routine text and the relocated resource link — the link
 * moved off the setup screens to here, since instructions is where "the
 * extra optional stuff about the practice" now lives (PI1: media stays
 * URLs-only, the link is the ONLY link, surfaced in this same editor).
 */
export default function PracticeInstructions() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Consume the seed on mount (read-and-clear): a cancel then leaves the
  // slot empty, so the parent keeps its state. Save re-seeds below.
  const [seed] = useState(() => takeInstructionsDraft());
  const [instructions, setInstructions] = useState(seed?.instructions ?? '');
  const [resourceUrl, setResourceUrl] = useState(seed?.resourceUrl ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    const trimmedUrl = resourceUrl.trim();
    if (trimmedUrl && !isHttpUrl(trimmedUrl)) {
      setError('that link needs to start with http:// or https://');
      return;
    }
    // Hand the edited draft back; the parent's focus read applies it.
    seedInstructionsDraft({ instructions: instructions.trim(), resourceUrl: trimmedUrl });
    router.back();
  };

  return (
    <KeyboardFriendlyScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 24 + insets.top }]}
    >
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.back}>{STRINGS.practiceInstructionsBackToSetup}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{STRINGS.practiceInstructionsTitle}</Text>
      <Text style={styles.helper}>{STRINGS.practiceInstructionsHelper}</Text>

      <Text style={[circleFormStyles.label, styles.sectionSpacing]}>
        {STRINGS.practiceInstructionsLabel}
      </Text>
      <MicTextInput
        style={[circleFormStyles.input, styles.instructionsInput]}
        containerStyle={styles.instructionsRow}
        placeholder={STRINGS.practiceInstructionsPlaceholder}
        placeholderTextColor={colors.muted}
        value={instructions}
        onChangeText={setInstructions}
        multiline
        textAlignVertical="top"
        maxLength={MAX_INSTRUCTIONS_LENGTH}
      />

      <ResourceLinkField value={resourceUrl} onChange={setResourceUrl} style={styles.sectionSpacing} />

      <TouchableOpacity style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>{STRINGS.practiceInstructionsSaveCta}</Text>
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
    padding: 24,
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
    fontSize: 22,
    color: colors.ink,
    marginBottom: 8,
  },
  helper: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  sectionSpacing: {
    marginTop: 24,
  },
  // Multiline: the mic sits at the bottom of the tall box, not centered.
  instructionsRow: {
    alignItems: 'flex-end',
  },
  instructionsInput: {
    minHeight: 140,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});
