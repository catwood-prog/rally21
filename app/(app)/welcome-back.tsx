import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { SignalMeter } from '@/components/SignalMeter';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { CircleMember, getCircleMembers, getCirclePresence, getMyPrimaryCircle, MyCircle } from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';
import { markReentryAcknowledged } from '@/lib/profile';
import { computeSignal, PresenceRow } from '@/lib/signal';
import { getWallMessages, WallMessage } from '@/lib/wall';

export default function WelcomeBack() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId, lastCompletionDate } = useLocalSearchParams<{
    circleId: string;
    lastCompletionDate: string;
  }>();

  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [awayMessages, setAwayMessages] = useState<WallMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);

  useEffect(() => {
    if (!session?.user || !circleId) return;
    (async () => {
      try {
        const [myCircle, circleMembers, circlePresence, wallMessages] = await Promise.all([
          getMyPrimaryCircle(session.user.id),
          getCircleMembers(circleId),
          getCirclePresence(circleId),
          getWallMessages(circleId),
        ]);
        setCircle(myCircle);
        setMembers(circleMembers);
        setPresence(circlePresence);
        setAwayMessages(wallMessages.filter((m) => m.createdAt.slice(0, 10) > (lastCompletionDate ?? '')));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [session?.user?.id, circleId, lastCompletionDate]);

  const memberName = (userId: string) => {
    if (userId === session?.user.id) return 'You';
    return members.find((m) => m.userId === userId)?.name ?? 'circle-mate';
  };

  const acknowledge = async () => {
    if (!session?.user || !lastCompletionDate) return;
    try {
      await markReentryAcknowledged(session.user.id, lastCompletionDate);
    } catch {
      // best-effort — worst case this screen shows once more than intended
    }
  };

  const handlePractice = async () => {
    setIsNavigating(true);
    await acknowledge();
    router.replace({ pathname: '/checkin', params: { circleId } });
  };

  const handleBackToToday = async () => {
    setIsNavigating(true);
    await acknowledge();
    router.replace('/today');
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  const isSolo = members.length === 1;
  const signal = circle
    ? computeSignal({
        presence,
        memberCount: members.length,
        today: getLocalDateString(),
        circleStartDate: circle.startDate,
      })
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Brandmark style={styles.brandmark} />
      <Text style={styles.eyebrow}>welcome back</Text>
      <Text style={styles.title}>
        you&apos;ve <Text style={styles.titleAccent}>missed nothing</Text>
      </Text>
      <Text style={styles.subtitle}>
        no streak lost, no guilt — your circle&apos;s still glowing.
      </Text>

      {signal && (
        <View style={styles.signalCard}>
          <SignalMeter
            state={signal.state}
            dailyRates={signal.dailyRates}
            dayNumber={signal.dayNumber}
            durationDays={circle?.durationDays}
            isSolo={isSolo}
            size="large"
          />
        </View>
      )}

      <Text style={styles.sectionLabel}>while you were away</Text>
      {awayMessages.length === 0 ? (
        <Text style={styles.emptyAway}>it was quiet — nothing you missed</Text>
      ) : (
        awayMessages.map((m) => (
          <View key={m.id} style={styles.messageCard}>
            <Text style={styles.messageSender}>{memberName(m.userId)}</Text>
            <Text style={styles.messageBody}>{m.body}</Text>
          </View>
        ))
      )}

      <TouchableOpacity style={styles.primaryButton} onPress={handlePractice} disabled={isNavigating}>
        <Text style={styles.primaryButtonText}>Do today&apos;s practice</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={handleBackToToday} disabled={isNavigating}>
        <Text style={styles.secondaryButtonText}>Back to today</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  content: {
    padding: 20,
    paddingBottom: 64,
  },
  brandmark: {
    marginBottom: 14,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 6,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 26,
    color: colors.ink,
    lineHeight: 32,
    marginBottom: 8,
  },
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 29,
    color: colors.green,
  },
  subtitle: {
    fontSize: 13.5,
    color: colors.muted,
    lineHeight: 19,
    marginBottom: 22,
  },
  signalCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 18,
    marginBottom: 26,
    ...cardShadow,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 10,
  },
  emptyAway: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 26,
  },
  messageCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    ...cardShadow,
  },
  messageSender: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 3,
  },
  messageBody: {
    fontSize: 13,
    color: colors.ink,
    lineHeight: 18,
  },
  primaryButton: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 15,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 10,
  },
  primaryButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  secondaryButton: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontWeight: '700',
    fontSize: 13.5,
    color: colors.ink,
  },
});
