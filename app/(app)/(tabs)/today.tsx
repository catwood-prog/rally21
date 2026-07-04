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

import { Avatar } from '@/components/Avatar';
import { Brandmark } from '@/components/Brandmark';
import { SignalMeter } from '@/components/SignalMeter';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { unlockAudioContext } from '@/lib/chime';
import {
  CircleMember,
  getCircleMembers,
  getCirclePresence,
  listMyCircles,
  MyCircle,
  subscribeToCirclePresence,
} from '@/lib/circle';
import { daysBetween, getLocalDateString } from '@/lib/date';
import { getMyProfile } from '@/lib/profile';
import { computeSignal, PresenceRow } from '@/lib/signal';

const MAX_CIRCLES = 3;
const CIRCLE_COUNT_WORD: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three' };

function greeting(name: string | null) {
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${timeOfDay}${name ? `, ${name}` : ''}`;
}

type CircleData = { members: CircleMember[]; presence: PresenceRow[] };

export default function Today() {
  const router = useRouter();
  const { session } = useAuth();
  const [circles, setCircles] = useState<MyCircle[]>([]);
  const [circleData, setCircleData] = useState<Record<string, CircleData>>({});
  const [myName, setMyName] = useState<string | null>(null);
  const [hasSeenCheckinConsent, setHasSeenCheckinConsent] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    try {
      const [profile, myCircles] = await Promise.all([
        getMyProfile(session.user.id),
        listMyCircles(session.user.id),
      ]);
      setMyName(profile?.name ?? null);
      setHasSeenCheckinConsent(profile?.has_seen_checkin_consent ?? false);
      setCircles(myCircles);

      if (myCircles.length === 0) {
        setCircleData({});
        return;
      }

      const entries = await Promise.all(
        myCircles.map(async (c): Promise<[string, CircleData]> => {
          const [members, presence] = await Promise.all([
            getCircleMembers(c.id),
            getCirclePresence(c.id),
          ]);
          return [c.id, { members, presence }];
        })
      );
      setCircleData(Object.fromEntries(entries));

      // "welcome back" shows once per gap of 2+ missed days, based on the
      // user's most recent completion across every circle — never on a
      // fresh start with no completions yet, and never twice for the same
      // gap once it's been acknowledged.
      const today = getLocalDateString();
      const allMyDates = entries
        .flatMap(([, data]) => data.presence)
        .filter((p) => p.userId === session.user.id)
        .map((p) => p.localDate)
        .sort();
      const lastCompletionDate = allMyDates[allMyDates.length - 1];
      if (
        lastCompletionDate &&
        daysBetween(lastCompletionDate, today) >= 3 &&
        profile?.last_reentry_ack_date !== lastCompletionDate
      ) {
        setIsRedirecting(true);
        router.replace({
          pathname: '/welcome-back',
          params: { circleId: myCircles[0].id, lastCompletionDate },
        });
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your circles');
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id, router]);

  // refetch every time Today comes back into focus (e.g. returning from check-in)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // live updates whenever anyone in any of these circles checks in
  const circleIds = circles.map((c) => c.id).join(',');
  useEffect(() => {
    if (!circleIds) return;
    const ids = circleIds.split(',');
    const unsubscribes = ids.map((id) =>
      subscribeToCirclePresence(id, () => {
        getCirclePresence(id).then((presence) => {
          setCircleData((prev) => ({ ...prev, [id]: { members: prev[id]?.members ?? [], presence } }));
        });
      })
    );
    return () => unsubscribes.forEach((u) => u());
  }, [circleIds]);

  if (isLoading || isRedirecting) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  const today = getLocalDateString();
  const atCap = circles.length >= MAX_CIRCLES;

  const goToCheckin = (circle: MyCircle, wantsTimer: boolean, dayNumber: number) => {
    const wantsTimerWithDuration = wantsTimer && !!circle.practiceDurationMinutes;

    // Must happen synchronously inside this tap — iOS Safari only unlocks
    // audio playback for an AudioContext created/resumed directly inside a
    // user gesture, not after any awaited work.
    if (wantsTimerWithDuration) unlockAudioContext();

    const timerParams = wantsTimerWithDuration
      ? {
          startTimer: 'true',
          durationMinutes: String(circle.practiceDurationMinutes),
          circleName: circle.name,
          dayNumber: String(Math.min(dayNumber, circle.durationDays)),
        }
      : {};

    if (!hasSeenCheckinConsent) {
      router.push({ pathname: '/checkin-intro', params: { circleId: circle.id, ...timerParams } });
    } else if (wantsTimerWithDuration) {
      router.push({ pathname: '/checkin-timer', params: { circleId: circle.id, ...timerParams } });
    } else {
      router.push({ pathname: '/checkin', params: { circleId: circle.id } });
    }
  };

  const handleAddCircle = () => {
    if (atCap) {
      router.push('/onboarding/circle-cap');
    } else {
      router.push({ pathname: '/onboarding/circle-setup', params: { fromToday: 'true' } });
    }
  };

  const addCircleButton = (
    <TouchableOpacity style={styles.addCircleLink} onPress={handleAddCircle}>
      <Text style={styles.addCircleLinkText}>
        + add a circle <Text style={styles.addCircleCount}>({circles.length} of {MAX_CIRCLES})</Text>
      </Text>
    </TouchableOpacity>
  );

  // ---- zero circles: nothing to show but a way back in ----
  if (circles.length === 0) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.topbar}>
          <Brandmark />
          <TouchableOpacity onPress={() => router.push('/settings')}>
            <Text style={styles.signOut}>Settings</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.greeting}>{greeting(myName)}</Text>
        <Text style={styles.subtitle}>{error ?? "you're not in a circle yet"}</Text>
        {addCircleButton}
      </ScrollView>
    );
  }

  // ---- exactly one circle: identical to the pre-multi-circle Today ----
  if (circles.length === 1) {
    const circle = circles[0];
    const data = circleData[circle.id] ?? { members: [], presence: [] };
    const { members, presence } = data;
    const inTodayUserIds = new Set(
      presence.filter((p) => p.localDate === today).map((p) => p.userId)
    );
    const iAmCheckedInToday = !!session?.user && inTodayUserIds.has(session.user.id);
    const inCount = inTodayUserIds.size;
    const isSolo = members.length === 1;
    const signal = computeSignal({
      presence,
      memberCount: members.length,
      today,
      circleStartDate: circle.startDate,
    });

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.topbar}>
          <Brandmark />
          <TouchableOpacity onPress={() => router.push('/settings')}>
            <Text style={styles.signOut}>Settings</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.greeting}>{greeting(myName)}</Text>

        <Text style={styles.headline}>
          {isSolo ? (
            <>
              today you <Text style={styles.headlineAccent}>{circle.practiceName?.toLowerCase()}</Text>
            </>
          ) : (
            <>
              today you{' '}
              <Text style={styles.headlineAccent}>{circle.practiceName?.toLowerCase()}</Text>
              {'\n'}with <Text style={styles.headlineAccent}>your circle</Text>
            </>
          )}
        </Text>

        <TouchableOpacity style={styles.card} onPress={() => router.push('/circle')}>
          <SignalMeter
            state={signal.state}
            dailyRates={signal.dailyRates}
            dayNumber={signal.dayNumber}
            durationDays={circle.durationDays}
            isSolo={isSolo}
          />
          <Text style={styles.cardLink}>
            {isSolo ? 'view your practice →' : `${inCount} of ${members.length} in today · view circle →`}
          </Text>
        </TouchableOpacity>

        <View style={styles.membersRow}>
          {members.map((member) => {
            const isMe = member.userId === session?.user.id;
            const checkedIn = inTodayUserIds.has(member.userId);
            return (
              <View key={member.userId} style={styles.memberItem}>
                <View style={styles.avatarWrap}>
                  <Avatar
                    name={member.name}
                    avatarUrl={member.avatarUrl}
                    size={42}
                    ring={checkedIn ? 'done' : 'pending'}
                  />
                  {checkedIn && <Text style={styles.avatarCheck}>✓</Text>}
                </View>
                <Text style={styles.memberName} numberOfLines={1}>
                  {isMe ? 'You' : member.name ?? 'circle-mate'}
                </Text>
              </View>
            );
          })}
        </View>

        {!iAmCheckedInToday && circle.practiceDurationMinutes ? (
          <View style={styles.timerChoiceRow}>
            <TouchableOpacity
              style={styles.markDoneButton}
              onPress={() => goToCheckin(circle, false, signal.dayNumber)}
            >
              <Text style={styles.markDoneButtonText}>Just mark as done</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.startTimerButton}
              onPress={() => goToCheckin(circle, true, signal.dayNumber)}
            >
              <Text style={styles.startTimerButtonText}>Start timer</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.cta} onPress={() => goToCheckin(circle, false, signal.dayNumber)}>
            <Text style={styles.ctaText}>{iAmCheckedInToday ? "Edit today's check-in" : 'Check in'}</Text>
          </TouchableOpacity>
        )}

        {isSolo && (
          <TouchableOpacity
            style={styles.inviteHint}
            onPress={() =>
              router.push({
                pathname: '/onboarding/invite',
                params: { circleId: circle.id, inviteCode: circle.inviteCode },
              })
            }
          >
            <Text style={styles.inviteHintText}>even better with your people →</Text>
          </TouchableOpacity>
        )}

        <View style={styles.reflectionsRow}>
          <TouchableOpacity onPress={() => router.push('/weekly')}>
            <Text style={styles.reflectionsLink}>This week</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/journal')}>
            <Text style={styles.reflectionsLink}>Your journal</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/reflection')}>
            <Text style={styles.reflectionsLink}>Something we noticed</Text>
          </TouchableOpacity>
        </View>

        {addCircleButton}
      </ScrollView>
    );
  }

  // ---- two or three circles: the stack ----
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topbar}>
        <Brandmark />
        <TouchableOpacity onPress={() => router.push('/settings')}>
          <Text style={styles.signOut}>Settings</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.greeting}>{greeting(myName)}</Text>

      <Text style={styles.headline}>
        {CIRCLE_COUNT_WORD[circles.length] ?? circles.length} small things{' '}
        <Text style={styles.headlineAccent}>today</Text>
      </Text>

      {circles.map((circle) => {
        const data = circleData[circle.id] ?? { members: [], presence: [] };
        const { members, presence } = data;
        const inTodayUserIds = new Set(
          presence.filter((p) => p.localDate === today).map((p) => p.userId)
        );
        const iAmCheckedInToday = !!session?.user && inTodayUserIds.has(session.user.id);
        const inCount = inTodayUserIds.size;
        const isSolo = members.length === 1;
        const signal = computeSignal({
          presence,
          memberCount: members.length,
          today,
          circleStartDate: circle.startDate,
        });

        return (
          <View key={circle.id} style={styles.stackCard}>
            <TouchableOpacity onPress={() => router.push('/circle')}>
              <Text style={styles.stackCardName}>{circle.name}</Text>
              <SignalMeter
                state={signal.state}
                dailyRates={signal.dailyRates}
                dayNumber={signal.dayNumber}
                durationDays={circle.durationDays}
                isSolo={isSolo}
              />
              <Text style={styles.cardLink}>
                {isSolo ? 'view your practice →' : `${inCount} of ${members.length} in today · view circle →`}
              </Text>
            </TouchableOpacity>

            <View style={styles.membersRow}>
              {members.map((member) => {
                const isMe = member.userId === session?.user.id;
                const checkedIn = inTodayUserIds.has(member.userId);
                return (
                  <View key={member.userId} style={styles.memberItem}>
                    <View style={styles.avatarWrap}>
                      <Avatar
                        name={member.name}
                        avatarUrl={member.avatarUrl}
                        size={38}
                        ring={checkedIn ? 'done' : 'pending'}
                      />
                      {checkedIn && <Text style={styles.avatarCheck}>✓</Text>}
                    </View>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {isMe ? 'You' : member.name ?? 'circle-mate'}
                    </Text>
                  </View>
                );
              })}
            </View>

            {!iAmCheckedInToday && circle.practiceDurationMinutes ? (
              <View style={styles.timerChoiceRow}>
                <TouchableOpacity
                  style={styles.markDoneButton}
                  onPress={() => goToCheckin(circle, false, signal.dayNumber)}
                >
                  <Text style={styles.markDoneButtonText}>Just mark as done</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.startTimerButton}
                  onPress={() => goToCheckin(circle, true, signal.dayNumber)}
                >
                  <Text style={styles.startTimerButtonText}>Start timer</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.cta}
                onPress={() => goToCheckin(circle, false, signal.dayNumber)}
              >
                <Text style={styles.ctaText}>{iAmCheckedInToday ? "Edit today's check-in" : 'Check in'}</Text>
              </TouchableOpacity>
            )}

            {isSolo && (
              <TouchableOpacity
                style={styles.inviteHint}
                onPress={() =>
                  router.push({
                    pathname: '/onboarding/invite',
                    params: { circleId: circle.id, inviteCode: circle.inviteCode },
                  })
                }
              >
                <Text style={styles.inviteHintText}>even better with your people →</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      {addCircleButton}

      <View style={styles.reflectionsRow}>
        <TouchableOpacity onPress={() => router.push('/weekly')}>
          <Text style={styles.reflectionsLink}>This week</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/journal')}>
          <Text style={styles.reflectionsLink}>Your journal</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/reflection')}>
          <Text style={styles.reflectionsLink}>Something we noticed</Text>
        </TouchableOpacity>
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
  },
  content: {
    padding: 20,
    paddingBottom: 64,
  },
  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
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
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
    lineHeight: 29,
    marginBottom: 16,
  },
  headlineAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 28,
    color: colors.green,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 15,
    marginBottom: 16,
  },
  stackCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  stackCardName: {
    fontFamily: FONT_HEADER,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 8,
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
    marginTop: 14,
    marginBottom: 18,
  },
  memberItem: {
    alignItems: 'center',
    width: 56,
  },
  avatarWrap: {
    width: 42,
    height: 42,
    position: 'relative',
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
  timerChoiceRow: {
    flexDirection: 'row',
    gap: 10,
  },
  markDoneButton: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  markDoneButtonText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.ink,
  },
  startTimerButton: {
    flex: 1,
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  startTimerButtonText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.ink,
  },
  inviteHint: {
    marginTop: 14,
    alignItems: 'center',
  },
  inviteHintText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.green,
  },
  reflectionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
    marginTop: 20,
  },
  reflectionsLink: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  addCircleLink: {
    marginTop: 22,
    alignItems: 'center',
  },
  addCircleLinkText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.green,
  },
  addCircleCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
});
