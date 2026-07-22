import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { unlockAudioContext } from '@/lib/chime';
import { markCheckinConsentSeen } from '@/lib/profile';

export default function CheckinIntro() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId, startTimer, durationMinutes, circleName, dayNumber, resourceUrl } =
    useLocalSearchParams<{
      circleId: string;
      startTimer?: string;
      durationMinutes?: string;
      circleName?: string;
      dayNumber?: string;
      resourceUrl?: string;
    }>();
  const [isSaving, setIsSaving] = useState(false);
  // NAV1 job 0 — this one-shot consent moment is AppHeader-exempt, but
  // exemption from the header is never exemption from safe areas.
  const insets = useSafeAreaInsets();

  const goesToActivityScreen = (startTimer === 'true' && !!durationMinutes) || !!resourceUrl;

  const handleContinue = async () => {
    if (!session?.user) return;
    // Must happen synchronously inside this tap, before any await — see
    // lib/chime.ts for why.
    if (goesToActivityScreen) unlockAudioContext();
    setIsSaving(true);
    try {
      await markCheckinConsentSeen(session.user.id);
    } catch {
      // non-blocking — worst case this intro shows once more than intended
    }
    if (goesToActivityScreen) {
      router.replace({
        pathname: '/checkin-timer',
        params: { circleId, durationMinutes, circleName, dayNumber, resourceUrl },
      });
    } else {
      router.replace({ pathname: '/checkin', params: { circleId } });
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.topLeft, { top: 20 + insets.top }]}>
        <Brandmark />
        {/* NAV1: a mistaken "check in" tap needs a way out that isn't
            the consent button — quiet, never blocks the moment. */}
        <TouchableOpacity style={styles.back} onPress={() => router.replace('/today')}>
          <Text style={styles.backText}>← today</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.lock}>
        <Text style={styles.lockText}>🔒 private</Text>
      </View>

      <Text style={styles.title}>
        this builds your <Text style={styles.titleAccent}>private picture</Text>
      </Text>

      <Text style={styles.body}>
        Your answers help the app gently spot your patterns. Only you ever see this — you can
        correct or delete anything, anytime.
      </Text>

      <TouchableOpacity style={styles.button} onPress={handleContinue} disabled={isSaving}>
        {isSaving ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>Got it</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  topLeft: {
    position: 'absolute',
    left: 24,
    alignItems: 'flex-start',
  },
  back: {
    marginTop: 10,
    paddingVertical: 4,
  },
  backText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  lock: {
    backgroundColor: colors.greenSoft,
    borderRadius: 99,
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginBottom: 22,
  },
  lockText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.green,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 30,
    marginBottom: 16,
  },
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    color: colors.green,
    fontSize: 27,
  },
  body: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 32,
  },
  button: {
    width: '100%',
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 15,
    alignItems: 'center',
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});
