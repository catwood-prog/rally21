import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { MASCOT } from '@/assets/mascot';
import { Avatar } from '@/components/Avatar';
import { Brandmark } from '@/components/Brandmark';
import { MascotEntrance } from '@/components/MascotEntrance';
import { MASCOT_FX, WARM_EASE_IN_OUT, WARM_EASE_OUT } from '@/lib/motion';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { coverMember } from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';
import { isFriendNudgeEnabled, sendFriendNudge } from '@/lib/wall';

type Mode = 'cover' | 'wave';

export default function CoverAFriend() {
  const router = useRouter();
  // NAV1 job 0 only — the cover flow itself is deliberately untouched
  // (Cat is reworking it separately); this is just the safe-area inset.
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { circleId, memberId, memberName, memberAvatarUrl, myName, alreadyCheckedIn } = useLocalSearchParams<{
    circleId: string;
    memberId: string;
    memberName?: string;
    memberAvatarUrl?: string;
    myName?: string;
    alreadyCheckedIn?: string;
  }>();
  const name = memberName || 'your circle-mate';
  const covererName = myName || 'someone in your circle';
  // W1 (7 July): a member who's already checked in can only be waved at
  // — covering a day that's already done makes no sense (and RLS would
  // reject it), so this is wave-only from the start, not just the default.
  const isWaveOnly = alreadyCheckedIn === 'true';

  const [mode, setMode] = useState<Mode>(isWaveOnly ? 'wave' : 'cover');
  const [nudgeAllowed, setNudgeAllowed] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!memberId) return;
    isFriendNudgeEnabled(memberId)
      .then(setNudgeAllowed)
      .catch(() => setNudgeAllowed(true));
  }, [memberId]);

  const goBackToCircle = () => router.replace({ pathname: '/circle', params: { circleId } });

  // M2 (f) — one gentle squeeze on the art when a cover successfully
  // lands (scale 1 → 0.98 → 1, ≤300ms), then the navigation proceeds.
  // Under reduced motion the navigation is immediate.
  const reduceMotion = useReducedMotion();
  const squeezeScale = useSharedValue(1);
  const squeezeStyle = useAnimatedStyle(() => ({ transform: [{ scale: squeezeScale.value }] }));
  const squeezeThen = (done: () => void) => {
    if (reduceMotion) {
      done();
      return;
    }
    squeezeScale.value = withSequence(
      withTiming(MASCOT_FX.COVER_SQUEEZE_SCALE, { duration: MASCOT_FX.COVER_SQUEEZE_IN_MS, easing: WARM_EASE_OUT }),
      withTiming(1, { duration: MASCOT_FX.COVER_SQUEEZE_OUT_MS, easing: WARM_EASE_IN_OUT })
    );
    setTimeout(done, MASCOT_FX.COVER_SQUEEZE_IN_MS + MASCOT_FX.COVER_SQUEEZE_OUT_MS + 20);
  };

  const handleSubmit = async () => {
    if (!session?.user || !circleId || !memberId) return;
    setIsSaving(true);
    try {
      if (mode === 'cover') {
        await coverMember(circleId, memberId, session.user.id, getLocalDateString());
        squeezeThen(goBackToCircle);
      } else {
        // Security spec S1 (F4): the RPC composes the email + wall copy
        // server-side from a fixed template now — the client no longer
        // sends subject/HTML/wall text.
        const result = await sendFriendNudge({
          circleId,
          recipientId: memberId,
          localDate: getLocalDateString(),
        });
        if (result === 'already_nudged') {
          setError(STRINGS.alreadyNudgedError(name));
          setIsSaving(false);
          return;
        }
        if (result === 'wave_cap_reached') {
          setError(STRINGS.waveCapReachedError);
          setIsSaving(false);
          return;
        }
        if (result === 'blocked') {
          setError(STRINGS.waveNotDeliveredError);
          setIsSaving(false);
          return;
        }
        goBackToCircle();
      }
    } catch (e) {
      // "nudges disabled" can only reach here via a race (opted out
      // between load and submit) since the option is hidden client-side
      // whenever we already know it's off — same warm mapping either way.
      // Self-wave/not-a-member shouldn't be reachable at all from this
      // screen's own navigation, so they fall to the plain fallback.
      const message = e instanceof Error ? e.message : '';
      if (message.includes('nudges disabled')) {
        setError(STRINGS.waveOptedOutError(name));
      } else {
        setError('something went wrong — try again');
      }
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: 20 + insets.top, paddingBottom: 14 + insets.bottom }]}>
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity onPress={goBackToCircle}>
        <Text style={styles.back}>← circle</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Animated.View style={squeezeStyle}>
          <MascotEntrance source={MASCOT.coverAFriend} style={styles.mascot} />
        </Animated.View>
        <Avatar name={name} userId={memberId ?? ""} avatarUrl={memberAvatarUrl} size={88} />
        <Text style={styles.headline}>
          {isWaveOnly ? STRINGS.waveHeadline(name) : STRINGS.coverHeadline(name)}
        </Text>
        <Text style={styles.subtitle}>{isWaveOnly ? STRINGS.waveSubtitle : STRINGS.coverSubtitle}</Text>

        <View style={styles.noteCard}>
          <Text style={styles.noteText}>
            {isWaveOnly ? STRINGS.waveNotePreview(covererName, name) : STRINGS.coverNotePreview(covererName)}
          </Text>
        </View>

        <View style={styles.optionList}>
          {!isWaveOnly && (
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => setMode('cover')}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === 'cover' }}
            >
              <Text style={styles.optionText}>{STRINGS.coverActionLabel}</Text>
              {mode === 'cover' && (
                <View style={styles.pickPill}>
                  <Text style={styles.pickPillText}>Pick</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          {nudgeAllowed && (
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => setMode('wave')}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === 'wave' }}
            >
              <Text style={styles.optionText}>{STRINGS.waveActionLabel}</Text>
              {mode === 'wave' && (
                <View style={styles.pickPill}>
                  <Text style={styles.pickPillText}>Pick</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <TouchableOpacity style={styles.cta} onPress={handleSubmit} disabled={isSaving}>
        {isSaving ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.ctaText}>{mode === 'cover' ? STRINGS.coverCta(name) : STRINGS.waveCta(name)}</Text>
        )}
      </TouchableOpacity>

      <MessageDialog
        visible={!!error}
        title="hmm"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 14,
  },
  brandmark: {
    marginBottom: 14,
  },
  back: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 10,
  },
  mascot: {
    width: 150,
    height: 136,
    marginBottom: 6,
  },
  headline: {
    fontFamily: FONT_HEADER,
    fontSize: 20,
    color: colors.ink,
    marginTop: 14,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
    textAlign: 'center',
  },
  noteCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginTop: 18,
    ...cardShadow,
  },
  noteText: {
    fontSize: 11.5,
    color: colors.muted,
    lineHeight: 17,
  },
  optionList: {
    width: '100%',
    gap: 9,
    marginTop: 14,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...cardShadow,
  },
  optionText: {
    fontSize: 13,
    color: colors.ink,
  },
  pickPill: {
    backgroundColor: colors.green,
    borderRadius: 99,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  pickPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  cta: {
    backgroundColor: colors.green,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  ctaText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#fff',
  },
});
