import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { KeyboardFriendlyScrollView } from '@/components/KeyboardFriendlyScrollView';
import {
  CircleNameField,
  circleFormStyles,
  ResourceLinkField,
  TIME_OPTIONS,
  TimeOfDayField,
} from '@/components/CircleFormFields';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { activateWant } from '@/lib/blueprint';
import { unlockAudioContext } from '@/lib/chime';
import { setCircleResourceUrl } from '@/lib/circle';
import { createCircle } from '@/lib/circle-setup';
import { getMyProfile } from '@/lib/profile';
import { isHttpUrl } from '@/lib/resourceLink';

export default function TheCommitment() {
  const router = useRouter();
  // NAV1 job 0 — no AppHeader on pre-signed-in-chrome screens, but the
  // safe-area inset still applies.
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { practiceKey, practiceName, practiceDurationMinutes, solo, fromToday, wantKey, wantStatement } =
    useLocalSearchParams<{
      practiceKey: string;
      practiceName: string;
      practiceDurationMinutes?: string;
      solo?: string;
      fromToday?: string;
      wantKey?: string;
      wantStatement?: string;
    }>();
  const isSolo = solo === 'true';
  const isFromToday = fromToday === 'true';

  const [circleName, setCircleName] = useState(practiceName ?? '');
  const [selectedTime, setSelectedTime] = useState(TIME_OPTIONS[0].time);
  // Solo-only: does their first check-in happen now or tomorrow? Default
  // "right now" so an evening signup reaches the check-in flow this session
  // instead of committing to a time and leaving having done nothing (SF1).
  const [startFirstNow, setStartFirstNow] = useState(true);
  const [isPublic, setIsPublic] = useState(false);
  const [resourceUrl, setResourceUrl] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSetIt = async () => {
    if (!practiceKey) return;
    const trimmedUrl = resourceUrl.trim();
    if (trimmedUrl && !isHttpUrl(trimmedUrl)) {
      setError('that link needs to start with http:// or https://');
      return;
    }

    // For a solo "right now" check-in, mirror Today's check-in CTA: a timed
    // practice (or one with a resource link) routes through the timer/activity
    // screen. That screen chimes, so the audio context must be unlocked
    // synchronously inside this tap, before any await — iOS Safari only unlocks
    // playback within the user gesture itself (see lib/chime.ts). Harmless when
    // it turns out we route to the plain check-in instead.
    const durationMinutes = practiceDurationMinutes
      ? parseInt(practiceDurationMinutes, 10) || 0
      : 0;
    const goesToActivityScreen = !!trimmedUrl || durationMinutes > 0;
    if (isSolo && startFirstNow && goesToActivityScreen) unlockAudioContext();

    setIsCreating(true);
    try {
      const { circleId, inviteCode } = await createCircle(
        practiceKey,
        selectedTime,
        circleName,
        isSolo ? false : isPublic
      );
      if (trimmedUrl) {
        await setCircleResourceUrl(circleId, trimmedUrl).catch(() => {
          // non-blocking — the circle exists either way; they can add the
          // link later from the circle screen
        });
      }
      if (wantKey && session?.user) {
        // The wants act flow — "make this your next 21 days." The circle
        // now exists either way; a failure to record the activation just
        // means the blueprint's want card won't show the quiet "now your
        // practice" state, never a reason to fail circle creation itself.
        await activateWant({
          userId: session.user.id,
          wantKey,
          wantStatement: wantStatement ?? '',
          circleId,
        }).catch(() => {});
      }
      if (isSolo) {
        if (startFirstNow) {
          // Route straight into the check-in flow for the circle they just
          // made — the same entry Today's check-in CTA uses: checkin-intro
          // if the first-time private-picture consent hasn't been seen yet,
          // otherwise straight to the timer (for a timed practice / resource
          // link) or the plain check-in (SF1). A brand-new stranger has never
          // seen consent, so they'll get the intro — which itself forwards to
          // the timer when startTimer+duration/resourceUrl are present; the
          // else branch covers a returning user spinning up another solo circle.
          const activityParams = goesToActivityScreen
            ? {
                circleName: circleName.trim(),
                dayNumber: '1',
                ...(durationMinutes > 0 ? { durationMinutes: String(durationMinutes) } : {}),
                ...(trimmedUrl ? { resourceUrl: trimmedUrl } : {}),
              }
            : {};

          let hasSeenConsent = false;
          if (session?.user) {
            try {
              const profile = await getMyProfile(session.user.id);
              hasSeenConsent = profile?.has_seen_checkin_consent ?? false;
            } catch {
              // non-blocking — worst case they see the one-time consent intro
              // again, which is harmless
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
      } else {
        router.replace({
          pathname: '/onboarding/invite',
          params: { circleId, inviteCode, ...(isFromToday ? { fromToday: 'true' } : {}) },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong — try again');
      setIsCreating(false);
    }
  };

  const selectedTimeLabel =
    TIME_OPTIONS.find((o) => o.time === selectedTime)?.label.toLowerCase() ?? '';

  return (
    <KeyboardFriendlyScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 24 + insets.top }]}
    >
      <Brandmark style={styles.brandmark} />
      <View style={styles.topbar}>
        {/* NAV1: back() keeps the practice browse state when there's
            history; a cold-loaded URL falls back to the real parent. */}
        <TouchableOpacity
          onPress={() =>
            isFromToday
              ? router.push('/today')
              : router.canGoBack()
                ? router.back()
                : router.push('/onboarding/create-circle')
          }
        >
          <Text style={styles.back}>{isFromToday ? '← Today' : '← Back'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>
        {isSolo ? (
          (practiceName ?? 'your practice').toLowerCase()
        ) : (
          <>
            {(practiceName ?? 'your practice').toLowerCase()},{' '}
            <Text style={styles.titleAccent}>together</Text>
          </>
        )}
      </Text>

      <CircleNameField value={circleName} onChange={setCircleName} />

      <TimeOfDayField value={selectedTime} onChange={setSelectedTime} style={styles.sectionSpacing} />

      <Text style={styles.hint}>daily, for 21 days — a couple lines a day, that&apos;s it</Text>

      {isSolo && (
        <>
          <Text style={[circleFormStyles.label, styles.sectionSpacing]}>
            {STRINGS.soloFirstWhenLabel}
          </Text>
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
        </>
      )}

      <ResourceLinkField value={resourceUrl} onChange={setResourceUrl} style={styles.sectionSpacing} />

      {!isSolo && (
        <>
          <Text style={[circleFormStyles.label, styles.sectionSpacing]}>who can join</Text>

          <TouchableOpacity
            style={[styles.visibilityCard, !isPublic && styles.visibilityCardSelected]}
            onPress={() => setIsPublic(false)}
          >
            <Text style={styles.visibilityTitle}>🔒 Private</Text>
            <Text style={styles.visibilityBody}>
              Only people you invite can join — share a code to bring them in.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.visibilityCard, isPublic && styles.visibilityCardSelected]}
            onPress={() => setIsPublic(true)}
          >
            <Text style={styles.visibilityTitle}>🌍 Public</Text>
            <Text style={styles.visibilityBody}>Anyone on Rally21 can find and join this circle.</Text>
            <Text style={styles.visibilityDisclosure}>{STRINGS.publicShareDisclosure}</Text>
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity
        style={[styles.button, !circleName.trim() && styles.buttonDisabled]}
        onPress={handleSetIt}
        disabled={!circleName.trim() || isCreating}
      >
        {isCreating ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>Set it</Text>
        )}
      </TouchableOpacity>

      <MessageDialog
        visible={!!error}
        title="hmm"
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
  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  back: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 22,
    color: colors.ink,
    lineHeight: 28,
    marginBottom: 22,
  },
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 25,
    color: colors.green,
  },
  sectionSpacing: {
    marginTop: 24,
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 14,
    lineHeight: 17,
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
