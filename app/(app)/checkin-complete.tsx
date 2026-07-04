import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getCircleMembers, getCirclePresence, getMyPrimaryCircle } from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';

export default function CheckInComplete() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId } = useLocalSearchParams<{ circleId: string }>();
  const [inCount, setInCount] = useState<number | null>(null);
  const [isSolo, setIsSolo] = useState<boolean | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  useEffect(() => {
    if (!circleId || !session?.user) return;
    const today = getLocalDateString();

    Promise.all([
      getCirclePresence(circleId),
      getCircleMembers(circleId),
      getMyPrimaryCircle(session.user.id),
    ])
      .then(([presence, members, circle]) => {
        const uniqueToday = new Set(
          presence.filter((p) => p.localDate === today).map((p) => p.userId)
        );
        setInCount(uniqueToday.size);
        setIsSolo(members.length === 1);
        setInviteCode(circle?.inviteCode ?? null);
      })
      .catch(() => setInCount(null));
  }, [circleId, session?.user?.id]);

  return (
    <View style={styles.container}>
      <Text style={styles.confetti}>🎉✨🎉</Text>
      <View style={styles.checkCircle}>
        <Text style={styles.checkMark}>✓</Text>
      </View>
      <Text style={styles.title}>you&apos;re in</Text>

      {inCount === null || isSolo === null ? (
        <ActivityIndicator color={colors.green} style={styles.spinner} />
      ) : (
        <Text style={styles.subtitle}>
          {isSolo
            ? 'you showed up for yourself today'
            : `${inCount} ${inCount === 1 ? 'person has' : 'people have'} checked in today`}
        </Text>
      )}

      {isSolo && inviteCode && (
        <TouchableOpacity
          style={styles.inviteHint}
          onPress={() =>
            router.push({
              pathname: '/onboarding/invite',
              params: { circleId, inviteCode },
            })
          }
        >
          <Text style={styles.inviteHintText}>even better with your people →</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.button} onPress={() => router.replace('/today')}>
        <Text style={styles.buttonText}>Back to Today</Text>
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
    paddingHorizontal: 24,
  },
  confetti: {
    fontSize: 34,
    letterSpacing: 6,
    marginBottom: 10,
  },
  checkCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  checkMark: {
    fontSize: 40,
    color: '#fff',
    fontWeight: '700',
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 26,
    color: colors.ink,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 28,
  },
  spinner: {
    marginBottom: 28,
  },
  inviteHint: {
    marginBottom: 28,
  },
  inviteHintText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.green,
  },
  button: {
    width: '100%',
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});
