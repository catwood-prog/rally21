import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { SignalMeter } from '@/components/SignalMeter';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { CircleMember, getCircleMembers, getCirclePresence, listMyCircles, MyCircle } from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';
import { markReentryAcknowledged } from '@/lib/profile';
import { computeSignal, PresenceRow } from '@/lib/signal';
import { getWallMessages, WallMessage } from '@/lib/wall';

type CircleData = { members: CircleMember[]; presence: PresenceRow[]; awayMessages: WallMessage[] };

export default function WelcomeBack() {
  const router = useRouter();
  const { session } = useAuth();
  const { lastCompletionDate } = useLocalSearchParams<{ lastCompletionDate: string }>();

  const [circles, setCircles] = useState<MyCircle[]>([]);
  const [circleData, setCircleData] = useState<Record<string, CircleData>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);

  // Re-entry is triggered off the user's most recent completion across
  // EVERY circle (see Today), so "what did I miss" has to cover all of
  // them too — not just whichever one happened to be first in the list.
  const load = useCallback(async () => {
    if (!session?.user) return;
    try {
      const myCircles = await listMyCircles(session.user.id);
      setCircles(myCircles);

      const entries = await Promise.all(
        myCircles.map(async (c): Promise<[string, CircleData]> => {
          const [members, presence, wallMessages] = await Promise.all([
            getCircleMembers(c.id),
            getCirclePresence(c.id),
            getWallMessages(c.id),
          ]);
          const awayMessages = wallMessages.filter(
            (m) => m.createdAt.slice(0, 10) > (lastCompletionDate ?? '')
          );
          return [c.id, { members, presence, awayMessages }];
        })
      );
      setCircleData(Object.fromEntries(entries));
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id, lastCompletionDate]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const acknowledge = async () => {
    if (!session?.user || !lastCompletionDate) return;
    try {
      await markReentryAcknowledged(session.user.id, lastCompletionDate);
    } catch {
      // best-effort — worst case this screen shows once more than intended
    }
  };

  const handlePractice = async (circleId: string) => {
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Brandmark style={styles.brandmark} />
      <Text style={styles.eyebrow}>welcome back</Text>
      <Text style={styles.title}>
        you&apos;ve <Text style={styles.titleAccent}>missed nothing</Text>
      </Text>
      <Text style={styles.subtitle}>
        no streak lost, no guilt — {circles.length === 1 ? "your circle's" : 'your circles are'}{' '}
        still glowing.
      </Text>

      {circles.map((circle) => {
        const data = circleData[circle.id] ?? { members: [], presence: [], awayMessages: [] };
        const isSolo = data.members.length === 1;
        const signal = computeSignal({
          presence: data.presence,
          memberCount: data.members.length,
          today: getLocalDateString(),
          circleStartDate: circle.startDate,
        });
        const memberName = (userId: string) => {
          if (userId === session?.user.id) return 'You';
          return data.members.find((m) => m.userId === userId)?.name ?? 'circle-mate';
        };

        return (
          <View key={circle.id} style={styles.circleBlock}>
            <Text style={styles.circleName}>{STRINGS.reentryKeptLightOn(circle.name)}</Text>

            <View style={styles.signalCard}>
              <SignalMeter
                state={signal.state}
                dailyRates={signal.dailyRates}
                dayNumber={signal.dayNumber}
                durationDays={circle.durationDays}
                isSolo={isSolo}
                size="large"
              />
            </View>

            <Text style={styles.sectionLabel}>while you were away</Text>
            {data.awayMessages.length === 0 ? (
              <Text style={styles.emptyAway}>it was quiet — nothing you missed</Text>
            ) : (
              data.awayMessages.map((m) => (
                <View key={m.id} style={styles.messageCard}>
                  <Text style={styles.messageSender}>{memberName(m.userId)}</Text>
                  <Text style={styles.messageBody}>{m.body}</Text>
                </View>
              ))
            )}

            {circles.length === 1 && (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => handlePractice(circle.id)}
                disabled={isNavigating}
              >
                <Text style={styles.primaryButtonText}>Do today&apos;s practice</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

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
  circleBlock: {
    marginBottom: 10,
  },
  circleName: {
    fontFamily: FONT_HEADER,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 10,
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
    marginTop: 6,
  },
  secondaryButtonText: {
    fontWeight: '700',
    fontSize: 13.5,
    color: colors.ink,
  },
});
