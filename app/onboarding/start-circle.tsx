import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { KeyboardFriendlyScrollView } from '@/components/KeyboardFriendlyScrollView';
import {
  CircleNameField,
  circleFormStyles,
  PracticeInstructionsField,
  TIME_OPTIONS,
  TimeOfDayField,
} from '@/components/CircleFormFields';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { activateWant } from '@/lib/blueprint';
import { createCircleWithDose } from '@/lib/circle-setup';
import { seedInstructionsDraft, takeInstructionsDraft } from '@/lib/practiceInstructionsDraft';
import { groupingLine } from '@/lib/practiceTaxonomy';
import { isHttpUrl } from '@/lib/resourceLink';

/**
 * CF2 screen 5 — CIRCLE SETUP: the practice is LOCKED (chosen one screen
 * ago — the summary card just restates it), and visibility is an
 * EXPLICIT choice with NO preselection: an accidental public circle
 * isn't worth one saved tap (Cat's adopted ruling). Creating a PUBLIC
 * circle on a still-private custom practice flips that practice shared
 * (PT1's is_shared model) — that consequence gets its own explicit
 * confirm step, never buried in visibility copy.
 */
export default function StartCircle() {
  const router = useRouter();
  // NAV1 job 0 — no AppHeader on pre-signed-in-chrome screens, but the
  // safe-area inset still applies.
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const params = useLocalSearchParams<{
    practiceKey: string;
    practiceName: string;
    practiceType: string;
    timerSuggested?: string;
    defaultDuration?: string;
    privateCustom?: string;
    fromToday?: string;
    wantKey?: string;
    wantStatement?: string;
  }>();
  const { practiceKey, practiceName, practiceType, fromToday, wantKey, wantStatement } = params;
  const isFromToday = fromToday === 'true';
  const isPrivateCustom = params.privateCustom === 'true';

  const [circleName, setCircleName] = useState(practiceName ?? '');
  const [duration, setDuration] = useState(
    params.defaultDuration ?? (params.timerSuggested === 'true' ? '10' : '')
  );
  const [selectedTime, setSelectedTime] = useState(TIME_OPTIONS[0].time);
  const [resourceUrl, setResourceUrl] = useState('');
  // PI1 — the optional routine + link now live on their own screen; this
  // holds the draft the sub-screen hands back.
  const [instructions, setInstructions] = useState('');
  // Visibility: null until the person actually chooses — the create
  // button stays disabled, never a default.
  const [isPublic, setIsPublic] = useState<boolean | null>(null);
  // The share-flip confirm step (inline, per the app's confirm-inline
  // convention) — shown instead of the create button when creating
  // public would make a private custom practice visible to others.
  const [confirmingShareFlip, setConfirmingShareFlip] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouping = practiceType ? groupingLine(practiceType) : null;
  const minutes = duration.trim() ? parseInt(duration.trim(), 10) || 0 : 0;
  const canCreate = !!circleName.trim() && isPublic !== null;
  const hasInstructions = !!instructions.trim() || !!resourceUrl.trim();

  // PI1 — a non-null slot on focus means the editor saved; apply it. A
  // null slot (first mount, or a cancel) leaves the draft as-is.
  useFocusEffect(
    useCallback(() => {
      const draft = takeInstructionsDraft();
      if (draft) {
        setInstructions(draft.instructions);
        setResourceUrl(draft.resourceUrl);
      }
    }, [])
  );

  const openInstructions = () => {
    seedInstructionsDraft({ instructions, resourceUrl });
    router.push('/onboarding/practice-instructions');
  };

  const doCreate = async () => {
    if (!practiceKey || isPublic === null) return;
    const trimmedUrl = resourceUrl.trim();
    if (trimmedUrl && !isHttpUrl(trimmedUrl)) {
      setError('that link needs to start with http:// or https://');
      return;
    }
    setIsCreating(true);
    try {
      const { circleId, inviteCode } = await createCircleWithDose({
        practiceKey,
        timeOfDay: selectedTime,
        circleName: circleName.trim(),
        isPublic,
        durationMinutes: minutes > 0 ? minutes : null,
        resourceUrl: trimmedUrl || null,
        instructions: instructions.trim() || null,
      });

      if (wantKey && session?.user) {
        await activateWant({
          userId: session.user.id,
          wantKey,
          wantStatement: wantStatement ?? '',
          circleId,
        }).catch(() => {});
      }

      if (isPublic) {
        // Public circles are already joinable by anyone — land on the
        // circle itself rather than the invite/share ceremony.
        router.replace('/circle');
      } else {
        router.replace({
          pathname: '/onboarding/invite',
          params: { circleId, inviteCode, ...(isFromToday ? { fromToday: 'true' } : {}) },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong — try again');
      setIsCreating(false);
      setConfirmingShareFlip(false);
    }
  };

  const handleCreatePress = () => {
    if (!canCreate) return;
    // The consequence check: public + a custom practice only its creator
    // can currently see → its own explicit step.
    if (isPublic && isPrivateCustom) {
      setConfirmingShareFlip(true);
      return;
    }
    doCreate();
  };

  return (
    <KeyboardFriendlyScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 24 + insets.top }]}
    >
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity
        onPress={() =>
          router.canGoBack()
            ? router.back()
            : router.push(isFromToday ? '/today' : '/onboarding/create-circle')
        }
      >
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{STRINGS.circleSetupTitle}</Text>

      {/* The locked practice summary — chosen already, restated here. */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryName}>
          🔒 {minutes > 0 ? STRINGS.practiceDose(practiceName ?? '', minutes) : practiceName}
        </Text>
        {grouping && <Text style={styles.summaryGrouping}>{grouping}</Text>}
      </View>

      <CircleNameField value={circleName} onChange={setCircleName} style={styles.sectionSpacing} />

      <Text style={[circleFormStyles.label, styles.sectionSpacing]}>{STRINGS.durationLabel}</Text>
      {params.timerSuggested === 'true' && (
        <Text style={styles.durationHelper}>{STRINGS.durationSuggestedHelper}</Text>
      )}
      <TextInput
        style={circleFormStyles.input}
        placeholder="minutes"
        placeholderTextColor={colors.muted}
        value={duration}
        onChangeText={(text) => setDuration(text.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
      />

      <TimeOfDayField value={selectedTime} onChange={setSelectedTime} style={styles.sectionSpacing} />

      <PracticeInstructionsField
        hasContent={hasInstructions}
        onPress={openInstructions}
        style={styles.sectionSpacing}
      />

      <Text style={[circleFormStyles.label, styles.sectionSpacing]}>{STRINGS.visibilityQuestion}</Text>

      <TouchableOpacity
        style={[styles.visibilityCard, isPublic === false && styles.visibilityCardSelected]}
        onPress={() => {
          setIsPublic(false);
          setConfirmingShareFlip(false);
        }}
      >
        <Text style={styles.visibilityTitle}>{STRINGS.visibilityPrivateTitle}</Text>
        <Text style={styles.visibilityBody}>{STRINGS.visibilityPrivateBody}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.visibilityCard, isPublic === true && styles.visibilityCardSelected]}
        onPress={() => setIsPublic(true)}
      >
        <Text style={styles.visibilityTitle}>{STRINGS.visibilityPublicTitle}</Text>
        <Text style={styles.visibilityBody}>{STRINGS.visibilityPublicBody}</Text>
        <Text style={styles.visibilityDisclosure}>{STRINGS.publicShareDisclosure}</Text>
      </TouchableOpacity>

      {confirmingShareFlip ? (
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>{STRINGS.shareFlipConfirmTitle}</Text>
          <Text style={styles.confirmBody}>{STRINGS.shareFlipConfirmBody(practiceName ?? '')}</Text>
          <TouchableOpacity style={styles.button} onPress={doCreate} disabled={isCreating}>
            {isCreating ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <Text style={styles.buttonText}>{STRINGS.shareFlipConfirmCta}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setConfirmingShareFlip(false);
              setIsPublic(false);
            }}
            disabled={isCreating}
          >
            <Text style={styles.confirmCancel}>{STRINGS.shareFlipCancel}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.button, !canCreate && styles.buttonDisabled]}
          onPress={handleCreatePress}
          disabled={!canCreate || isCreating}
        >
          {isCreating ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={styles.buttonText}>Set it</Text>
          )}
        </TouchableOpacity>
      )}

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
    marginBottom: 16,
  },
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 15,
    ...cardShadow,
  },
  summaryName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.ink,
  },
  summaryGrouping: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 2,
  },
  sectionSpacing: {
    marginTop: 22,
  },
  durationHelper: {
    fontSize: 12,
    color: colors.muted,
    marginTop: -4,
    marginBottom: 8,
  },
  visibilityCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
    padding: 15,
    marginBottom: 10,
    ...cardShadow,
  },
  visibilityCardSelected: {
    borderColor: colors.green,
  },
  visibilityTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 4,
  },
  visibilityBody: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  visibilityDisclosure: {
    fontSize: 11,
    color: colors.muted,
    lineHeight: 15,
    marginTop: 6,
    fontStyle: 'italic',
  },
  confirmCard: {
    backgroundColor: colors.goldSoft,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.gold,
    padding: 15,
    marginTop: 22,
  },
  confirmTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 6,
  },
  confirmBody: {
    fontSize: 12.5,
    color: colors.ink,
    lineHeight: 18,
    marginBottom: 12,
  },
  confirmCancel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.muted,
    textAlign: 'center',
    marginTop: 12,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginTop: 22,
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
