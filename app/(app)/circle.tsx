import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { SignalMeter } from '@/components/SignalMeter';
import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  CircleMember,
  getCircleMembers,
  getCirclePresence,
  getMyPrimaryCircle,
  MyCircle,
  subscribeToCirclePresence,
} from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';
import { computeSignal, PresenceRow } from '@/lib/signal';

export default function YourCircle() {
  const router = useRouter();
  const { session } = useAuth();
  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    try {
      const myCircle = await getMyPrimaryCircle(session.user.id);
      setCircle(myCircle);
      if (myCircle) {
        const [circleMembers, circlePresence] = await Promise.all([
          getCircleMembers(myCircle.id),
          getCirclePresence(myCircle.id),
        ]);
        setMembers(circleMembers);
        setPresence(circlePresence);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your circle');
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!circle) return;
    const unsubscribe = subscribeToCirclePresence(circle.id, () => {
      getCirclePresence(circle.id).then(setPresence);
    });
    return unsubscribe;
  }, [circle?.id]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  if (!circle || error) {
    return (
      <View style={styles.loading}>
        <Text style={styles.subtitle}>{error ?? "you're not in a circle yet"}</Text>
      </View>
    );
  }

  const today = getLocalDateString();
  const inTodayUserIds = new Set(
    presence.filter((p) => p.localDate === today).map((p) => p.userId)
  );
  const signal = computeSignal({
    presence,
    memberCount: members.length,
    today,
    circleStartDate: circle.startDate,
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.push('/(app)/today')}>
        <Text style={styles.back}>← Today</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{circle.name}</Text>
      <Text style={styles.subtitle}>
        {circle.practiceName?.toLowerCase()} · {members.length}{' '}
        {members.length === 1 ? 'member' : 'members'}
      </Text>

      <View style={styles.signalCard}>
        <SignalMeter
          state={signal.state}
          dailyRates={signal.dailyRates}
          dayNumber={signal.dayNumber}
          durationDays={circle.durationDays}
          size="large"
        />
      </View>

      <TouchableOpacity style={styles.wallButton} onPress={() => router.push('/wall')}>
        <Text style={styles.wallButtonText}>💬 Circle wall</Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>who&apos;s here</Text>
      {members.map((member) => {
        const isMe = member.userId === session?.user.id;
        const checkedIn = inTodayUserIds.has(member.userId);
        return (
          <View key={member.userId} style={styles.memberRow}>
            <View style={[styles.avatar, checkedIn ? styles.avatarDone : styles.avatarPending]}>
              <Text style={styles.avatarInitial}>
                {(member.name ?? '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{isMe ? 'You' : member.name ?? 'circle-mate'}</Text>
              <Text style={styles.memberStatus}>
                {checkedIn ? 'checked in today' : 'not yet today'}
              </Text>
            </View>
            {checkedIn && <Text style={styles.checkMark}>✓</Text>}
          </View>
        );
      })}
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
    padding: 24,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  back: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 16,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
    marginBottom: 18,
  },
  signalCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 18,
    marginBottom: 24,
  },
  wallButton: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 24,
  },
  wallButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 10,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarDone: {
    backgroundColor: '#ddd',
  },
  avatarPending: {
    backgroundColor: colors.bg,
    borderWidth: 2,
    borderColor: colors.line,
    borderStyle: 'dashed',
  },
  avatarInitial: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.muted,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.ink,
  },
  memberStatus: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  checkMark: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.green,
  },
});
