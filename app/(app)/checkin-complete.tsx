import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getCircleById, getCircleMembers, getCirclePresence } from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';

export default function CheckInComplete() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId, reflectionSkipped } = useLocalSearchParams<{
    circleId: string;
    reflectionSkipped?: string;
  }>();
  const wasSkipped = reflectionSkipped === 'true';
  const [circleName, setCircleName] = useState<string | null>(null);
  const [inCount, setInCount] = useState<number | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [isSolo, setIsSolo] = useState<boolean | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  useEffect(() => {
    if (!circleId || !session?.user) return;
    const today = getLocalDateString();

    Promise.all([getCirclePresence(circleId), getCircleMembers(circleId), getCircleById(circleId)])
      .then(([presence, members, circle]) => {
        const uniqueToday = new Set(
          presence.filter((p) => p.localDate === today).map((p) => p.userId)
        );
        setInCount(uniqueToday.size);
        setMemberCount(members.length);
        setIsSolo(members.length === 1);
        setInviteCode(circle?.inviteCode ?? null);
        setCircleName(circle?.name ?? null);
      })
      .catch(() => setInCount(null));
  }, [circleId, session?.user?.id]);

  if (wasSkipped) {
    return (
      <View style={styles.container}>
        <Brandmark style={styles.brandmark} />
        <Text style={styles.confetti}>🎉</Text>
        <Text style={styles.title}>nice — that&apos;s done</Text>

        {inCount === null || memberCount === null ? (
          <ActivityIndicator color={colors.green} style={styles.spinner} />
        ) : (
          <Text style={styles.subtitle}>
            {circleName ?? 'your circle'} marked done.{'\n'}
            {inCount} of {memberCount} in today
          </Text>
        )}

        <View style={styles.reflectionDoneBadge}>
          <Text style={styles.reflectionDoneBadgeText}>✓ reflection already done today</Text>
        </View>
        <Text style={styles.reflectionDoneNote}>
          no second questionnaire — one reflection a day, always
        </Text>

        <TouchableOpacity style={styles.button} onPress={() => router.replace('/today')}>
          <Text style={styles.buttonText}>Back to Today</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Brandmark style={styles.brandmark} />
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
  brandmark: {
    position: 'absolute',
    top: 20,
    left: 24,
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
    textAlign: 'center',
    lineHeight: 19,
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
  reflectionDoneBadge: {
    backgroundColor: '#EAF3EA',
    borderRadius: 99,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginTop: -14,
    marginBottom: 8,
  },
  reflectionDoneBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.green,
  },
  reflectionDoneNote: {
    fontSize: 10.5,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 28,
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
