import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Brandmark } from '@/components/Brandmark';
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
  const isSolo = members.length === 1;
  const signal = computeSignal({
    presence,
    memberCount: members.length,
    today,
    circleStartDate: circle.startDate,
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity onPress={() => router.push('/today')}>
        <Text style={styles.back}>← Today</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{circle.name}</Text>
      <Text style={styles.subtitle}>
        {isSolo
          ? circle.practiceName?.toLowerCase()
          : `${circle.practiceName?.toLowerCase()} · ${members.length} members`}
      </Text>

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

      {isSolo && <Text style={styles.inviteHint}>even better with your people</Text>}

      <TouchableOpacity
        style={styles.inviteButton}
        onPress={() =>
          router.push({
            pathname: '/onboarding/invite',
            params: { circleId: circle.id, inviteCode: circle.inviteCode },
          })
        }
      >
        <Text style={styles.inviteButtonText}>✨ Invite someone</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.wallButton} onPress={() => router.push('/wall')}>
        <Text style={styles.wallButtonText}>💬 Circle wall</Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>who&apos;s here</Text>
      {members.map((member) => {
        const isMe = member.userId === session?.user.id;
        const checkedIn = inTodayUserIds.has(member.userId);
        return (
          <View key={member.userId} style={styles.memberRow}>
            <Avatar
              name={member.name}
              avatarUrl={member.avatarUrl}
              size={40}
              ring={checkedIn ? 'done' : 'pending'}
            />
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
    paddingBottom: 64,
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
  inviteHint: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.green,
    textAlign: 'center',
    marginBottom: 10,
  },
  inviteButton: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.green,
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 10,
  },
  inviteButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.green,
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
