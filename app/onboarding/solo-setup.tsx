import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { KeyboardFriendlyScrollView } from '@/components/KeyboardFriendlyScrollView';
import { circleFormStyles, ResourceLinkField, TIME_OPTIONS, TimeOfDayField } from '@/components/CircleFormFields';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { activateWant } from '@/lib/blueprint';
import { unlockAudioContext } from '@/lib/chime';
import { createCircleWithDose } from '@/lib/circle-setup';
import { getMyProfile } from '@/lib/profile';
import { groupingLine } from '@/lib/practiceTaxonomy';
import { isHttpUrl } from '@/lib/resourceLink';

/**
 * CF2 screen 4 — SOLO SETUP: "{practice}, solo · a circle of one". No
 * circle name, no visibility, no invite anything — internally this is
 * the existing non-discoverable circle-of-one; the user never learns
 * that. SF1's right-now path is preserved whole: the first check-in
 * happens now (default) or tomorrow, and "now" routes into the same
 * check-in entry Today's CTA uses, guided timer included.
 *
 * "Anytime" note (spec job 4): NOT shipped — the four existing
 * time-of-day options stay. circles.time_of_day feeds the nudge/digest
 * machinery, and adding a fifth null-like value is its own follow-up
 * (ledgered in DEFERRED.md), not a silent side-effect of a flow rebuild.
 */
export default function SoloSetup() {
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
    fromToday?: string;
    wantKey?: string;
    wantStatement?: string;
  }>();
  const { practiceKey, practiceName, practiceType, fromToday, wantKey, wantStatement } = params;
  const isFromToday = fromToday === 'true';

  // PB1's timer rule: every practice takes an optional duration; one is
  // PRE-SUGGESTED only when the bank says a timer helps (or the custom
  // practice carries its own default dose). 10 minutes is the gentle
  // suggested starting dose — fully editable, fully clearable.
  const [duration, setDuration] = useState(
    params.defaultDuration ?? (params.timerSuggested === 'true' ? '10' : '')
  );
  const [selectedTime, setSelectedTime] = useState(TIME_OPTIONS[0].time);
  // SF1: does their first check-in happen now or tomorrow? Default now,
  // so an evening signup does something today instead of just planning.
  const [startFirstNow, setStartFirstNow] = useState(true);
  const [resourceUrl, setResourceUrl] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouping = practiceType ? groupingLine(practiceType) : null;
  const minutes = duration.trim() ? parseInt(duration.trim(), 10) || 0 : 0;

  const handleStart = async () => {
    if (!practiceKey) return;
    const trimmedUrl = resourceUrl.trim();
    if (trimmedUrl && !isHttpUrl(trimmedUrl)) {
      setError('that link needs to start with http:// or https://');
      return;
    }

    // A "right now" first check-in on a timed/linked practice routes
    // through the timer screen, which chimes — iOS Safari only unlocks
    // audio synchronously inside the user gesture (lib/chime.ts).
    const goesToActivityScreen = !!trimmedUrl || minutes > 0;
    if (startFirstNow && goesToActivityScreen) unlockAudioContext();

    setIsCreating(true);
    try {
      const { circleId } = await createCircleWithDose({
        practiceKey,
        timeOfDay: selectedTime,
        // Internally the circle-of-one just carries the practice's name.
        circleName: practiceName ?? '',
        isPublic: false,
        durationMinutes: minutes > 0 ? minutes : null,
        resourceUrl: trimmedUrl || null,
      });

      if (wantKey && session?.user) {
        // The wants act flow — recording the activation never blocks the
        // circle that now exists either way.
        await activateWant({
          userId: session.user.id,
          wantKey,
          wantStatement: wantStatement ?? '',
          circleId,
        }).catch(() => {});
      }

      if (startFirstNow) {
        const activityParams = goesToActivityScreen
          ? {
              circleName: practiceName ?? '',
              dayNumber: '1',
              ...(minutes > 0 ? { durationMinutes: String(minutes) } : {}),
              ...(trimmedUrl ? { resourceUrl: trimmedUrl } : {}),
            }
          : {};

        let hasSeenConsent = false;
        if (session?.user) {
          try {
            const profile = await getMyProfile(session.user.id);
            hasSeenConsent = profile?.has_seen_checkin_consent ?? false;
          } catch {
            // worst case they see the one-time consent intro again
          }
        }

        if (!hasSeenConsent) {
          router.replace({
            pathname: '/checkin-intro',
            params: {
              circleId,
              ...(goesToActivityScreen ? { startTimer: 'true' } : {}),
              ...activityParams,
            },
          });
        } else if (goesToActivityScreen) {
          router.replace({ pathname: '/checkin-timer', params: { circleId, ...activityParams } });
        } else {
          router.replace({ pathname: '/checkin', params: { circleId } });
        }
      } else {
        // "/" re-checks profile + membership and lands on Today
        router.replace('/');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong — try again');
      setIsCreating(false);
    }
  };

  const selectedTimeLabel = TIME_OPTIONS.find((o) => o.time === selectedTime)?.label.toLowerCase() ?? '';

  return (
    <KeyboardFriendlyScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 24 + insets.top }]}
    >
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity
        onPress={() =>
          isFromToday && !router.canGoBack()
            ? router.push('/today')
            : router.canGoBack()
              ? router.back()
              : router.push('/onboarding/create-circle')
        }
      >
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>
        {(practiceName ?? 'your practice').toLowerCase()}, solo
      </Text>
      <Text style={styles.titleAccent}>{STRINGS.soloSetupAccent}</Text>

      {/* The summary card — what these 21 days are: the dose in its one
          rendering shape ("Walk · 15 min"), the grouping, the promise. */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryName}>
          {minutes > 0 ? STRINGS.practiceDose(practiceName ?? '', minutes) : practiceName}
        </Text>
        {grouping && <Text style={styles.summaryGrouping}>{grouping}</Text>}
        <Text style={styles.summaryDays}>{STRINGS.soloSetupSummaryDays}</Text>
      </View>

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

      <Text style={[circleFormStyles.label, styles.sectionSpacing]}>{STRINGS.soloFirstWhenLabel}</Text>
      <View style={circleFormStyles.chipRow}>
        <TouchableOpacity
          style={[circleFormStyles.chip, startFirstNow && circleFormStyles.chipSelected]}
          onPress={() => setStartFirstNow(true)}
        >
          <Text style={[circleFormStyles.chipText, startFirstNow && circleFormStyles.chipTextSelected]}>
            {STRINGS.soloFirstNow}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[circleFormStyles.chip, !startFirstNow && circleFormStyles.chipSelected]}
          onPress={() => setStartFirstNow(false)}
        >
          <Text style={[circleFormStyles.chipText, !startFirstNow && circleFormStyles.chipTextSelected]}>
            {STRINGS.soloFirstTomorrow(selectedTimeLabel)}
          </Text>
        </TouchableOpacity>
      </View>

      <ResourceLinkField value={resourceUrl} onChange={setResourceUrl} style={styles.sectionSpacing} />

      <TouchableOpacity style={styles.button} onPress={handleStart} disabled={isCreating}>
        {isCreating ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>{STRINGS.soloStartCta}</Text>
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
    lineHeight: 28,
  },
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 15,
    color: colors.green,
    marginBottom: 18,
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
  summaryDays: {
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 6,
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
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});
