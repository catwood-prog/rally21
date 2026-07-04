import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { SignalMeter } from '@/components/SignalMeter';
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
import { getMyProfile } from '@/lib/profile';
import { computeSignal, PresenceRow } from '@/lib/signal';

function greeting(name: string | null) {
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${timeOfDay}${name ? `, ${name}` : ''}`;
}

export default function Today() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [myName, setMyName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    try {
      const [profile, myCircle] = await Promise.all([
        getMyProfile(session.user.id),
        getMyPrimaryCircle(session.user.id),
      ]);
      setMyName(profile?.name ?? null);
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

  // refetch every time Today comes back into focus (e.g. returning from check-in)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // live updates whenever anyone in the circle checks in
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

  const today = getLocalDateString();
  const inTodayUserIds = new Set(
    presence.filter((p) => p.localDate === today).map((p) => p.userId)
  );
  const iAmCheckedInToday = !!session?.user && inTodayUserIds.has(session.user.id);
  const inCount = inTodayUserIds.size;
  const signal = circle
    ? computeSignal({
        presence,
        memberCount: members.length,
        today,
        circleStartDate: circle.startDate,
      })
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topbar}>
        <Text style={styles.brand}>Rally21</Text>
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.greeting}>{greeting(myName)}</Text>

      {!circle || error ? (
        <Text style={styles.subtitle}>{error ?? "you're not in a circle yet"}</Text>
      ) : (
        <>
          <Text style={styles.headline}>
            today you <Text style={styles.headlineAccent}>{circle.practiceName?.toLowerCase()}</Text>
            {'\n'}with your circle
          </Text>

          <TouchableOpacity style={styles.card} onPress={() => router.push('/circle')}>
            {signal && (
              <SignalMeter
                state={signal.state}
                dailyRates={signal.dailyRates}
                dayNumber={signal.dayNumber}
                durationDays={circle.durationDays}
              />
            )}
            <Text style={styles.cardLink}>{inCount} of {members.length} in today · view circle →</Text>
          </TouchableOpacity>

          <View style={styles.membersRow}>
            {members.map((member) => {
              const isMe = member.userId === session?.user.id;
              const checkedIn = inTodayUserIds.has(member.userId);
              return (
                <View key={member.userId} style={styles.memberItem}>
                  <View
                    style={[
                      styles.avatar,
                      checkedIn ? styles.avatarDone : styles.avatarPending,
                    ]}
                  >
                    <Text style={styles.avatarInitial}>
                      {(member.name ?? '?').charAt(0).toUpperCase()}
                    </Text>
                    {checkedIn && <Text style={styles.avatarCheck}>✓</Text>}
                  </View>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {isMe ? 'You' : member.name ?? 'circle-mate'}
                  </Text>
                </View>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.cta}
            onPress={() =>
              router.push({ pathname: '/checkin', params: { circleId: circle.id } })
            }
          >
            <Text style={styles.ctaText}>
              {iAmCheckedInToday ? "Edit today's check-in" : 'Check in'}
            </Text>
          </TouchableOpacity>
        </>
      )}
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
    paddingBottom: 48,
  },
  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  brand: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.ink,
  },
  signOut: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '600',
  },
  greeting: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 4,
  },
  headline: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
    lineHeight: 29,
    marginBottom: 16,
  },
  headlineAccent: {
    color: colors.green,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 8,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 15,
    marginBottom: 16,
  },
  cardLink: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
  },
  membersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 24,
  },
  memberItem: {
    alignItems: 'center',
    width: 56,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarDone: {
    backgroundColor: '#ddd',
  },
  avatarPending: {
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.line,
    borderStyle: 'dashed',
  },
  avatarInitial: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.muted,
  },
  avatarCheck: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.green,
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 16,
    overflow: 'hidden',
  },
  memberName: {
    fontSize: 9,
    color: colors.muted,
    marginTop: 5,
  },
  cta: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  ctaText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});
