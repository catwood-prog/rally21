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
import { CheckedInBadge } from '@/components/CheckedInBadge';
import { GlowBadge } from '@/components/GlowBadge';
import { SignalMeter } from '@/components/SignalMeter';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { isVerbPhrasePractice, STRINGS } from '@/constants/strings';
import { cardShadow, chipTextShape, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getMyCircleCap, MAX_CIRCLES } from '@/lib/caps';
import { DailyQuestion, getDailyQuestion, getTodayReflection, isReflectionSubstantive } from '@/lib/checkin';
import { unlockAudioContext } from '@/lib/chime';
import {
  CircleMember,
  getCircleMembers,
  getCirclePresence,
  isSoloCircle,
  listMyCircles,
  MyCircle,
  subscribeToCirclePresence,
} from '@/lib/circle';
import { daysBetween, getLocalDateString } from '@/lib/date';
import { getMyGlow, Glow } from '@/lib/glow';
import { getMyLastCelebratedDay, getNextMilestone, shouldShowJourneyGate } from '@/lib/journey';
import { getMyProfile } from '@/lib/profile';
import { computeSignal, PresenceRow } from '@/lib/signal';

const CIRCLE_COUNT_WORD: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three' };

function greeting(name: string | null) {
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${timeOfDay}${name ? `, ${name}` : ''}`;
}

function memberFullName(members: CircleMember[], userId: string | null | undefined): string {
  return members.find((m) => m.userId === userId)?.name ?? 'someone in your circle';
}

type CircleData = { members: CircleMember[]; presence: PresenceRow[]; lastCelebratedDay: number };

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
  const [circleCap, setCircleCap] = useState(MAX_CIRCLES);
  const [reflectionQuestion, setReflectionQuestion] = useState<DailyQuestion | null>(null);
  // Defaults to true so the teaser never flashes before the real value
  // loads — it only ever matters once it resolves to false.
  const [hasWrittenReflectionToday, setHasWrittenReflectionToday] = useState(true);
  const [glow, setGlow] = useState<Glow | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    const today = getLocalDateString();
    try {
      const [profile, myCircles, myCircleCap, question, todayReflection, myGlow] = await Promise.all([
        getMyProfile(session.user.id),
        listMyCircles(session.user.id),
        getMyCircleCap(),
        getDailyQuestion(today),
        getTodayReflection(today),
        getMyGlow().catch(() => null),
      ]);
      setMyName(profile?.name ?? null);
      setHasSeenCheckinConsent(profile?.has_seen_checkin_consent ?? false);
      setCircles(myCircles);
      setCircleCap(myCircleCap);
      setReflectionQuestion(question);
      setHasWrittenReflectionToday(!!todayReflection && isReflectionSubstantive(todayReflection));
      setGlow(myGlow);

      if (myCircles.length === 0) {
        setCircleData({});
        return;
      }

      const entries = await Promise.all(
        myCircles.map(async (c): Promise<[string, CircleData]> => {
          const [members, presence, lastCelebratedDay] = await Promise.all([
            getCircleMembers(c.id),
            getCirclePresence(c.id),
            getMyLastCelebratedDay(c.id, session.user.id),
          ]);
          return [c.id, { members, presence, lastCelebratedDay }];
        })
      );
      setCircleData(Object.fromEntries(entries));

      // "welcome back" shows once per gap of 2+ missed days, based on the
      // user's most recent completion across every circle — never on a
      // fresh start with no completions yet, and never twice for the same
      // gap once it's been acknowledged.
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
          params: { lastCompletionDate },
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
          setCircleData((prev) => ({
            ...prev,
            [id]: {
              members: prev[id]?.members ?? [],
              presence,
              lastCelebratedDay: prev[id]?.lastCelebratedDay ?? 0,
            },
          }));
        });
      })
    );
    return () => unsubscribes.forEach((u) => u());
  }, [circleIds]);

  // Day-21 gate + later rally markers/major stops: the first circle (in
  // list order) with something unseen sends the user to the matching
  // full-screen moment — both are idempotent via last_celebrated_day, so
  // once seen neither fires again for that circle across refetches.
  useEffect(() => {
    if (isLoading || isRedirecting || !circles.length) return;
    const today = getLocalDateString();
    for (const c of circles) {
      const data = circleData[c.id];
      if (!data) continue;
      const dayNumber = computeSignal({
        presence: data.presence,
        memberCount: data.members.length,
        today,
        circleStartDate: c.startDate,
      }).dayNumber;
      if (shouldShowJourneyGate(dayNumber, c, data.lastCelebratedDay)) {
        router.push({ pathname: '/journey-gate', params: { circleId: c.id } });
        return;
      }
      if (c.ralliedOnAt && !c.completedAt) {
        const milestone = getNextMilestone(dayNumber, data.lastCelebratedDay);
        if (milestone) {
          router.push({
            pathname: '/celebration',
            params: { circleId: c.id, day: String(milestone.day), isMajorStop: String(milestone.isMajorStop) },
          });
          return;
        }
      }
    }
  }, [circles, circleData, isLoading, isRedirecting, router]);

  if (isLoading || isRedirecting) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  const today = getLocalDateString();
  const atCap = circles.length >= circleCap;

  const goToCheckin = (circle: MyCircle, wantsTimer: boolean, dayNumber: number) => {
    const wantsTimerWithDuration = wantsTimer && !!circle.practiceDurationMinutes;
    // A circle's resource link (video or otherwise) always routes through
    // the activity screen — it's the hero of that screen regardless of
    // whether the user tapped "start timer" or not (see checkin-timer.tsx).
    const goesToActivityScreen = !!circle.resourceUrl || wantsTimerWithDuration;

    // Must happen synchronously inside this tap — iOS Safari only unlocks
    // audio playback for an AudioContext created/resumed directly inside a
    // user gesture, not after any awaited work.
    if (goesToActivityScreen) unlockAudioContext();

    const activityParams = goesToActivityScreen
      ? {
          startTimer: 'true',
          ...(circle.practiceDurationMinutes
            ? { durationMinutes: String(circle.practiceDurationMinutes) }
            : {}),
          circleName: circle.name,
          dayNumber: String(Math.min(dayNumber, circle.durationDays)),
          ...(circle.resourceUrl ? { resourceUrl: circle.resourceUrl } : {}),
        }
      : {};

    if (!hasSeenCheckinConsent) {
      router.push({ pathname: '/checkin-intro', params: { circleId: circle.id, ...activityParams } });
    } else if (goesToActivityScreen) {
      router.push({ pathname: '/checkin-timer', params: { circleId: circle.id, ...activityParams } });
    } else {
      router.push({ pathname: '/checkin', params: { circleId: circle.id } });
    }
  };

  const handleAddCircle = () => {
    if (atCap) {
      router.push({ pathname: '/onboarding/circle-cap', params: { cap: String(circleCap) } });
    } else {
      router.push({ pathname: '/onboarding/circle-setup', params: { fromToday: 'true' } });
    }
  };

  const addCircleButton = (
    <TouchableOpacity style={styles.addCircleLink} onPress={handleAddCircle}>
      <Text style={styles.addCircleLinkText}>
        + add a circle <Text style={styles.addCircleCount}>({circles.length} of {circleCap})</Text>
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
        <GlowBadge glow={glow} />
        <Text style={styles.subtitle}>{error ?? "you're not in a circle yet"}</Text>
        {addCircleButton}
      </ScrollView>
    );
  }

  // ---- exactly one circle: identical to the pre-multi-circle Today ----
  if (circles.length === 1) {
    const circle = circles[0];
    const data = circleData[circle.id] ?? { members: [], presence: [], lastCelebratedDay: 0 };
    const { members, presence } = data;
    const inTodayUserIds = new Set(
      presence.filter((p) => p.localDate === today).map((p) => p.userId)
    );
    const iAmCheckedInToday = !!session?.user && inTodayUserIds.has(session.user.id);
    const iWasCoveredToday = presence.find(
      (p) => p.localDate === today && p.userId === session?.user?.id && p.kind === 'covered'
    );
    const inCount = inTodayUserIds.size;
    const isSolo = isSoloCircle(members.length);
    const signal = computeSignal({
      presence,
      memberCount: members.length,
      today,
      circleStartDate: circle.startDate,
    });
    const practiceName = circle.practiceName ?? '';
    const isVerbPhrase = isVerbPhrasePractice(practiceName);

    // A completed circle is warmly archived, read-only history — nothing
    // left to do today, so skip the check-in flow entirely and point
    // toward the circle screen's archive view instead.
    if (circle.completedAt) {
      return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <View style={styles.topbar}>
            <Brandmark />
            <TouchableOpacity onPress={() => router.push('/settings')}>
              <Text style={styles.signOut}>Settings</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.greeting}>{greeting(myName)}</Text>
          <GlowBadge glow={glow} coveredByName={iWasCoveredToday ? memberFullName(members, iWasCoveredToday.coveredBy) : null} />
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push({ pathname: '/circle', params: { circleId: circle.id } })}
          >
            <Text style={styles.completedCardBadge}>{STRINGS.journeyCompletedBadge}</Text>
            <Text style={styles.completedCardTitle}>{STRINGS.journeyCompletedTitle(circle.name)}</Text>
            <Text style={styles.completedCardBody}>{STRINGS.journeyCompletedBody}</Text>
          </TouchableOpacity>
          {addCircleButton}
        </ScrollView>
      );
    }

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.topbar}>
          <Brandmark />
          <TouchableOpacity onPress={() => router.push('/settings')}>
            <Text style={styles.signOut}>Settings</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.greeting}>{greeting(myName)}</Text>
        <GlowBadge glow={glow} coveredByName={iWasCoveredToday ? memberFullName(members, iWasCoveredToday.coveredBy) : null} />

        <Text style={styles.headline}>
          {isSolo ? (
            isVerbPhrase ? (
              <>
                today you <Text style={styles.headlineAccent}>{practiceName.toLowerCase()}</Text>
              </>
            ) : (
              <>
                today: <Text style={styles.headlineAccent}>{practiceName.toLowerCase()}</Text>
              </>
            )
          ) : isVerbPhrase ? (
            <>
              today you{' '}
              <Text style={styles.headlineAccent}>{practiceName.toLowerCase()}</Text>
              {'\n'}with <Text style={styles.headlineAccent}>your circle</Text>
            </>
          ) : (
            <>
              today: <Text style={styles.headlineAccent}>{practiceName.toLowerCase()}</Text>,
              {'\n'}with <Text style={styles.headlineAccent}>your circle</Text>
            </>
          )}
        </Text>

        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push({ pathname: '/circle', params: { circleId: circle.id } })}
        >
          <SignalMeter
            state={signal.state}
            dailyRates={signal.dailyRates}
            dayNumber={signal.dayNumber}
            durationDays={circle.durationDays}
            isSolo={isSolo}
            isRallied={!!circle.ralliedOnAt && !circle.completedAt}
          />
          <Text style={styles.cardLink}>
            {isSolo
              ? 'view your practice →'
              : `${
                  inCount === members.length
                    ? STRINGS.groupAllInCelebration(members.length, circle.name)
                    : STRINGS.cardLinkStatus(inCount, members.length)
                } · view circle →`}
          </Text>
        </TouchableOpacity>

        <View style={styles.membersRow}>
          {members.map((member) => {
            const isMe = member.userId === session?.user.id;
            const checkedIn = inTodayUserIds.has(member.userId);
            const isCovered = presence.some(
              (p) => p.localDate === today && p.userId === member.userId && p.kind === 'covered'
            );
            const state = isCovered ? 'covered' : checkedIn ? 'done' : 'pending';
            return (
              <View key={member.userId} style={styles.memberItem}>
                <View style={styles.avatarWrap}>
                  <Avatar name={member.name} avatarUrl={member.avatarUrl} size={42} ring={state} />
                  <CheckedInBadge state={state} />
                </View>
                <Text style={styles.memberName} numberOfLines={1}>
                  {isMe ? 'You' : member.name ?? 'circle-mate'}
                </Text>
              </View>
            );
          })}
        </View>

        {iWasCoveredToday ? (
          <View style={styles.coveredNoteCard}>
            <Text style={styles.coveredNoteText}>
              {STRINGS.coveredNoteToCoveredMember(memberFullName(members, iWasCoveredToday.coveredBy))}
            </Text>
          </View>
        ) : !iAmCheckedInToday && circle.practiceDurationMinutes && !circle.resourceUrl ? (
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
            style={[styles.cta, iAmCheckedInToday && styles.ctaSecondary]}
            onPress={() => goToCheckin(circle, false, signal.dayNumber)}
          >
            <Text style={[styles.ctaText, iAmCheckedInToday && styles.ctaSecondaryText]}>
              {iAmCheckedInToday ? STRINGS.editCheckinCta : STRINGS.checkInCta}
            </Text>
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

        {!hasWrittenReflectionToday && reflectionQuestion && (
          <TouchableOpacity
            style={styles.reflectionTeaser}
            onPress={() => goToCheckin(circle, false, signal.dayNumber)}
          >
            <Text style={styles.reflectionTeaserText}>
              {STRINGS.reflectionTeaser(reflectionQuestion.prompt)}
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.reflectionsRow}>
          <TouchableOpacity onPress={() => router.push('/weekly')}>
            <Text style={styles.reflectionsLink}>This week</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/journal')}>
            <Text style={styles.reflectionsLinkPlum}>Your journal</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/reflection')}>
            <Text style={styles.reflectionsLinkPlum}>Something we noticed</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/blueprint')}>
            <Text style={styles.reflectionsLinkPlum}>{STRINGS.blueprintLinkLabel}</Text>
          </TouchableOpacity>
        </View>

        {addCircleButton}
      </ScrollView>
    );
  }

  // ---- two or three circles: the stack ----
  // The glow is one global number, not per-circle — find the first
  // covered-today instance across any of them for the header's note.
  let coveredTodayName: string | null = null;
  for (const c of circles) {
    const data = circleData[c.id];
    if (!data) continue;
    const covered = data.presence.find(
      (p) => p.localDate === today && p.userId === session?.user?.id && p.kind === 'covered'
    );
    if (covered) {
      coveredTodayName = memberFullName(data.members, covered.coveredBy);
      break;
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topbar}>
        <Brandmark />
        <TouchableOpacity onPress={() => router.push('/settings')}>
          <Text style={styles.signOut}>Settings</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.greeting}>{greeting(myName)}</Text>
      <GlowBadge glow={glow} coveredByName={coveredTodayName} />

      <Text style={styles.headline}>
        {CIRCLE_COUNT_WORD[circles.length] ?? circles.length} small things{' '}
        <Text style={styles.headlineAccent}>today</Text>
      </Text>

      {circles.map((circle) => {
        const data = circleData[circle.id] ?? { members: [], presence: [], lastCelebratedDay: 0 };
        const { members, presence } = data;
        const inTodayUserIds = new Set(
          presence.filter((p) => p.localDate === today).map((p) => p.userId)
        );
        const iAmCheckedInToday = !!session?.user && inTodayUserIds.has(session.user.id);
        const iWasCoveredToday = presence.find(
          (p) => p.localDate === today && p.userId === session?.user?.id && p.kind === 'covered'
        );
        const inCount = inTodayUserIds.size;
        const isSolo = isSoloCircle(members.length);
        const signal = computeSignal({
          presence,
          memberCount: members.length,
          today,
          circleStartDate: circle.startDate,
        });

        if (circle.completedAt) {
          return (
            <TouchableOpacity
              key={circle.id}
              style={styles.stackCard}
              onPress={() => router.push({ pathname: '/circle', params: { circleId: circle.id } })}
            >
              <Text style={styles.completedCardBadge}>{STRINGS.journeyCompletedBadge}</Text>
              <Text style={styles.completedCardTitle}>{STRINGS.journeyCompletedTitle(circle.name)}</Text>
              <Text style={styles.completedCardBody}>{STRINGS.journeyCompletedBody}</Text>
            </TouchableOpacity>
          );
        }

        return (
          <View key={circle.id} style={styles.stackCard}>
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/circle', params: { circleId: circle.id } })}
            >
              <Text style={styles.stackCardName}>{circle.name}</Text>
              <SignalMeter
                state={signal.state}
                dailyRates={signal.dailyRates}
                dayNumber={signal.dayNumber}
                durationDays={circle.durationDays}
                isSolo={isSolo}
                isRallied={!!circle.ralliedOnAt && !circle.completedAt}
              />
              <Text style={styles.cardLink}>
                {isSolo
              ? 'view your practice →'
              : `${
                  inCount === members.length
                    ? STRINGS.groupAllInCelebration(members.length, circle.name)
                    : STRINGS.cardLinkStatus(inCount, members.length)
                } · view circle →`}
              </Text>
            </TouchableOpacity>

            <View style={styles.membersRow}>
              {members.map((member) => {
                const isMe = member.userId === session?.user.id;
                const checkedIn = inTodayUserIds.has(member.userId);
                const isCovered = presence.some(
                  (p) => p.localDate === today && p.userId === member.userId && p.kind === 'covered'
                );
                const state = isCovered ? 'covered' : checkedIn ? 'done' : 'pending';
                return (
                  <View key={member.userId} style={styles.memberItem}>
                    <View style={styles.avatarWrap}>
                      <Avatar name={member.name} avatarUrl={member.avatarUrl} size={38} ring={state} />
                      <CheckedInBadge state={state} />
                    </View>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {isMe ? 'You' : member.name ?? 'circle-mate'}
                    </Text>
                  </View>
                );
              })}
            </View>

            {iWasCoveredToday ? (
              <View style={styles.coveredNoteCard}>
                <Text style={styles.coveredNoteText}>
                  {STRINGS.coveredNoteToCoveredMember(memberFullName(members, iWasCoveredToday.coveredBy))}
                </Text>
              </View>
            ) : !iAmCheckedInToday && circle.practiceDurationMinutes && !circle.resourceUrl ? (
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
                style={[styles.cta, iAmCheckedInToday && styles.ctaSecondary]}
                onPress={() => goToCheckin(circle, false, signal.dayNumber)}
              >
                <Text style={[styles.ctaText, iAmCheckedInToday && styles.ctaSecondaryText]}>
                  {iAmCheckedInToday ? STRINGS.editCheckinCta : STRINGS.checkInCta}
                </Text>
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

      {!hasWrittenReflectionToday && reflectionQuestion && circles[0] && (
        <TouchableOpacity
          style={styles.reflectionTeaser}
          onPress={() => {
            const firstCircle = circles[0];
            const firstCircleData = circleData[firstCircle.id] ?? { members: [], presence: [], lastCelebratedDay: 0 };
            const firstCircleSignal = computeSignal({
              presence: firstCircleData.presence,
              memberCount: firstCircleData.members.length,
              today,
              circleStartDate: firstCircle.startDate,
            });
            goToCheckin(firstCircle, false, firstCircleSignal.dayNumber);
          }}
        >
          <Text style={styles.reflectionTeaserText}>
            {STRINGS.reflectionTeaser(reflectionQuestion.prompt)}
          </Text>
        </TouchableOpacity>
      )}

      <View style={styles.reflectionsRow}>
        <TouchableOpacity onPress={() => router.push('/weekly')}>
          <Text style={styles.reflectionsLink}>This week</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/journal')}>
          <Text style={styles.reflectionsLinkPlum}>Your journal</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/reflection')}>
          <Text style={styles.reflectionsLinkPlum}>Something we noticed</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/blueprint')}>
          <Text style={styles.reflectionsLinkPlum}>{STRINGS.blueprintLinkLabel}</Text>
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
    ...cardShadow,
  },
  stackCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    ...cardShadow,
  },
  stackCardName: {
    fontFamily: FONT_HEADER,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 8,
  },
  completedCardBadge: {
    ...chipTextShape,
    alignSelf: 'flex-start',
    backgroundColor: colors.greenSoft,
    color: colors.green,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
    overflow: 'hidden',
  },
  completedCardTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 4,
  },
  completedCardBody: {
    fontSize: 12.5,
    color: colors.muted,
    lineHeight: 18,
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
  // Once checked in, the day is complete — the outline treatment (same
  // idea as the "Invite someone" button, recolored gold) keeps editing
  // available without competing with the day's main action.
  ctaSecondary: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.gold,
    padding: 8,
  },
  coveredNoteCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.gold,
    padding: 14,
    ...cardShadow,
  },
  coveredNoteText: {
    fontSize: 12.5,
    color: colors.ink,
    lineHeight: 18,
    textAlign: 'center',
  },
  ctaText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  ctaSecondaryText: {
    fontWeight: '600',
    color: colors.gold,
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
  reflectionTeaser: {
    alignItems: 'center',
    marginTop: 20,
  },
  reflectionTeaserText: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 15,
    color: colors.plum,
    textAlign: 'center',
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
  // The inner-life layer's links (journal, day-14 observation) — plum,
  // scarce by design (see CLAUDE.md's color-roles convention). "This
  // week" stays muted since weekly show-up is progress, not reflection.
  reflectionsLinkPlum: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.plum,
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
