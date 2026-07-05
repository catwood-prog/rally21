import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Brandmark } from '@/components/Brandmark';
import { SignalMeter } from '@/components/SignalMeter';
import { FONT_HEADER } from '@/constants/fonts';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  CircleMember,
  getCircleById,
  getCircleMembers,
  getCirclePresence,
  listMyCircles,
  MyCircle,
  subscribeToCirclePresence,
} from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';
import { computeSignal, PresenceRow } from '@/lib/signal';
import { getWallPreview, subscribeToWall, WallPreviewItem } from '@/lib/wall';

const MAX_AVATARS_SHOWN = 8;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

type ListCircleData = { members: CircleMember[]; presence: PresenceRow[] };

export default function YourCircle() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId, fromTab } = useLocalSearchParams<{ circleId?: string; fromTab?: string }>();
  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [wallPreview, setWallPreview] = useState<WallPreviewItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Non-empty only when there's no circleId param AND the user is in more
  // than one circle — the tab's own root: a card per circle, tap through.
  const [listCircles, setListCircles] = useState<MyCircle[]>([]);
  const [listData, setListData] = useState<Record<string, ListCircleData>>({});

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    setListCircles([]);
    try {
      let myCircle: MyCircle | null;
      if (circleId) {
        myCircle = await getCircleById(circleId);
      } else {
        const myCircles = await listMyCircles(session.user.id);
        if (myCircles.length > 1) {
          const entries = await Promise.all(
            myCircles.map(async (c): Promise<[string, ListCircleData]> => {
              const [circleMembers, circlePresence] = await Promise.all([
                getCircleMembers(c.id),
                getCirclePresence(c.id),
              ]);
              return [c.id, { members: circleMembers, presence: circlePresence }];
            })
          );
          setListCircles(myCircles);
          setListData(Object.fromEntries(entries));
          setCircle(null);
          return;
        }
        myCircle = myCircles[0] ?? null;
      }
      setCircle(myCircle);
      if (myCircle) {
        const [circleMembers, circlePresence, preview] = await Promise.all([
          getCircleMembers(myCircle.id),
          getCirclePresence(myCircle.id),
          getWallPreview(myCircle.id),
        ]);
        setMembers(circleMembers);
        setPresence(circlePresence);
        setWallPreview(preview);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your circle');
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id, circleId]);

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

  useEffect(() => {
    if (!circle) return;
    const unsubscribe = subscribeToWall(circle.id, () => {
      getWallPreview(circle.id).then(setWallPreview);
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

  if (listCircles.length > 0) {
    const today = getLocalDateString();
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Brandmark style={styles.brandmark} />
        <Text style={styles.title}>your circles</Text>
        <Text style={styles.subtitle}>tap one to see how it&apos;s going</Text>

        {listCircles.map((c) => {
          const data = listData[c.id] ?? { members: [], presence: [] };
          const isSolo = data.members.length === 1;
          const signal = computeSignal({
            presence: data.presence,
            memberCount: data.members.length,
            today,
            circleStartDate: c.startDate,
          });
          const shown = data.members.slice(0, MAX_AVATARS_SHOWN);
          const overflow = data.members.length - shown.length;
          const inTodayIds = new Set(
            data.presence.filter((p) => p.localDate === today).map((p) => p.userId)
          );

          return (
            <TouchableOpacity
              key={c.id}
              style={styles.listCard}
              onPress={() => router.setParams({ circleId: c.id, fromTab: 'true' })}
            >
              <Text style={styles.listCardName}>{c.name}</Text>
              <SignalMeter
                state={signal.state}
                dailyRates={signal.dailyRates}
                dayNumber={signal.dayNumber}
                durationDays={c.durationDays}
                isSolo={isSolo}
              />
              <View style={[styles.avatarRow, styles.listCardAvatarRow]}>
                {shown.map((member) => {
                  const checkedIn = inTodayIds.has(member.userId);
                  return (
                    <View key={member.userId} style={styles.avatarRowItem}>
                      <Avatar
                        name={member.name}
                        avatarUrl={member.avatarUrl}
                        size={34}
                        ring={checkedIn ? 'done' : 'pending'}
                      />
                      {checkedIn && <Text style={styles.avatarCheck}>✓</Text>}
                    </View>
                  );
                })}
                {overflow > 0 && (
                  <View style={[styles.avatarOverflow, styles.avatarOverflowSmall]}>
                    <Text style={styles.avatarOverflowText}>+{overflow}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
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

  const memberName = (userId: string) => {
    if (userId === session?.user.id) return 'You';
    return members.find((m) => m.userId === userId)?.name ?? 'circle-mate';
  };

  const shownMembers = members.slice(0, MAX_AVATARS_SHOWN);
  const overflowCount = members.length - shownMembers.length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity
        onPress={() =>
          fromTab === 'true'
            ? router.replace('/circle')
            : router.push('/today')
        }
      >
        <Text style={styles.back}>{fromTab === 'true' ? '← Your Circles' : '← Today'}</Text>
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

      <View style={styles.wallPreviewCard}>
        <Text style={styles.sectionLabel}>circle wall</Text>
        {wallPreview.length === 0 ? (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/wall', params: { circleId: circle.id } })}
          >
            <Text style={styles.wallEmptyText}>the wall is quiet — say hi 👋</Text>
          </TouchableOpacity>
        ) : (
          <>
            {wallPreview.map((item) => (
              <Text key={item.id} style={styles.wallPreviewLine} numberOfLines={1}>
                {item.kind === 'message'
                  ? `${memberName(item.userId)}: ${truncate(item.body, 50)}`
                  : `${memberName(item.fromUserId)} reacted ${item.emoji} to ${
                      item.targetUserId === session?.user.id
                        ? 'your'
                        : `${memberName(item.targetUserId)}'s`
                    } check-in`}
              </Text>
            ))}
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/wall', params: { circleId: circle.id } })}
            >
              <Text style={styles.wallPreviewFooter}>open the circle wall →</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <Text style={styles.sectionLabel}>who&apos;s here</Text>
      <View style={styles.avatarRow}>
        {shownMembers.map((member) => {
          const checkedIn = inTodayUserIds.has(member.userId);
          return (
            <View key={member.userId} style={styles.avatarRowItem}>
              <Avatar
                name={member.name}
                avatarUrl={member.avatarUrl}
                size={40}
                ring={checkedIn ? 'done' : 'pending'}
              />
              {checkedIn && <Text style={styles.avatarCheck}>✓</Text>}
            </View>
          );
        })}
        {overflowCount > 0 && (
          <View style={styles.avatarOverflow}>
            <Text style={styles.avatarOverflowText}>+{overflowCount}</Text>
          </View>
        )}
      </View>
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
  listCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    ...cardShadow,
  },
  listCardName: {
    fontFamily: FONT_HEADER,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 8,
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
    ...cardShadow,
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 10,
  },
  wallPreviewCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    ...cardShadow,
  },
  wallEmptyText: {
    fontSize: 13,
    color: colors.muted,
  },
  wallPreviewLine: {
    fontSize: 12.5,
    color: colors.ink,
    marginBottom: 6,
  },
  wallPreviewFooter: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.green,
    marginTop: 4,
  },
  avatarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  listCardAvatarRow: {
    marginTop: 10,
    marginBottom: 0,
  },
  avatarRowItem: {
    width: 40,
    height: 40,
    position: 'relative',
  },
  avatarCheck: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.bg,
    backgroundColor: colors.green,
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 12,
    overflow: 'hidden',
  },
  avatarOverflow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverflowSmall: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  avatarOverflowText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
});
