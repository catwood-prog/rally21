import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Avatar } from '@/components/Avatar';
import { AppHeader } from '@/components/AppHeader';
import { ErrorSlip } from '@/components/ErrorSlip';
import { BirthdayBanner } from '@/components/BirthdayBanner';
import { CheckedInBadge } from '@/components/CheckedInBadge';
import { GlowBadge } from '@/components/GlowBadge';
import { PhotoAskCard } from '@/components/PhotoAskCard';
import { RemindersAskCard } from '@/components/RemindersAskCard';
import { SignalMeter } from '@/components/SignalMeter';
import { TodayFooter } from '@/components/TodayFooter';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { isVerbPhrasePractice, STRINGS } from '@/constants/strings';
import { cardShadow, chipTextShape, colors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useAuth } from '@/lib/auth-context';
import { getMyCircleCap, MAX_CIRCLES } from '@/lib/caps';
import { DailyQuestion, getDailyQuestion, getTodayReflection, isReflectionSubstantive } from '@/lib/checkin';
import { unlockAudioContext } from '@/lib/chime';
import {
  attachRestingStatus,
  CircleMember,
  getCircleMembers,
  getCirclePresence,
  isSoloCircle,
  listMyCircles,
  MyCircle,
  subscribeToCirclePresence,
} from '@/lib/circle';
import { isBirthdayToday } from '@/lib/birthday';
import { daysBetween, getLocalDateString } from '@/lib/date';
import { getGlowForCircleMates, getMyGlow, getMyWeek, Glow, WeekDay } from '@/lib/glow';
import { getMyLastCelebratedDay, getNextMilestone, shouldShowJourneyGate } from '@/lib/journey';
import { updateNotificationPrefs } from '@/lib/notifications';
import { getMyProfile, markPhotoAskSeen, markRemindersAskSeen } from '@/lib/profile';
import { hasUnrespondedDayObservation } from '@/lib/reflections';
import { computeSignal, PresenceRow } from '@/lib/signal';
import { hasPlayedTodayOneShot, markTodayOneShotPlayed } from '@/lib/todayOneShot';
import {
  buildWhisperLines,
  FreshWarmth,
  getFreshWarmth,
  getWallTeaser,
  isWallTeaserFresh,
  markWarmthSeen,
  WallTeaserItem,
} from '@/lib/warmth';

const CIRCLE_COUNT_WORD: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three' };

function greeting(name: string | null) {
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${timeOfDay}${name ? `, ${name}` : ''}`;
}

function memberFullName(members: CircleMember[], userId: string | null | undefined): string {
  return members.find((m) => m.userId === userId)?.name ?? 'someone in your circle';
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

type CircleData = {
  members: CircleMember[];
  presence: PresenceRow[];
  lastCelebratedDay: number;
  // GS1 — circle-mates at 7+ days glowing (server-floored), by user id.
  mateGlows: Map<string, number>;
  // WL2 — the latest wall line someone else left (post or celebration),
  // for the one-line teaser under the members; null = nothing to tease.
  teaser: WallTeaserItem | null;
};

export default function Today() {
  const router = useRouter();
  const { session } = useAuth();
  // TB3 — inset-aware pill clearance; applied to every state's scroll.
  const tabBarClearance = useTabBarClearance();
  const [circles, setCircles] = useState<MyCircle[]>([]);
  const [circleData, setCircleData] = useState<Record<string, CircleData>>({});
  const [myName, setMyName] = useState<string | null>(null);
  const [myBirthday, setMyBirthday] = useState<{ month: number | null; day: number | null; celebrate: boolean }>({
    month: null,
    day: null,
    celebrate: true,
  });
  const [hasSeenCheckinConsent, setHasSeenCheckinConsent] = useState(true);
  // RM1 — defaults true so the card never flashes before the real value
  // loads; only ever matters once it resolves to false. This screen only
  // ever renders once onboarding is fully complete (see the (app) layout
  // gate), so a null flag here always means "existing user, never asked
  // yet" — a still-mid-onboarding account sees the onboarding step
  // instead (hooks/use-onboarding-status.ts's 'needs-reminders-ask').
  const [hasSeenRemindersAsk, setHasSeenRemindersAsk] = useState(true);
  // AV1 — the one-shot photo ask. Both flags default to the "never
  // show" side so the card can't flash before the real values load;
  // hasAnyOwnCompletion is the chosen gate ("first check-in
  // celebration"): true once ANY completions row (self or covered)
  // exists for this user in a current circle.
  const [hasSeenPhotoAsk, setHasSeenPhotoAsk] = useState(true);
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  const [hasAnyOwnCompletion, setHasAnyOwnCompletion] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [circleCap, setCircleCap] = useState(MAX_CIRCLES);
  const [reflectionQuestion, setReflectionQuestion] = useState<DailyQuestion | null>(null);
  // Defaults to true so the teaser never flashes before the real value
  // loads — it only ever matters once it resolves to false.
  const [hasWrittenReflectionToday, setHasWrittenReflectionToday] = useState(true);
  const [glow, setGlow] = useState<Glow | null>(null);
  const [week, setWeek] = useState<WeekDay[] | null>(null);
  const [hasSurfacedPattern, setHasSurfacedPattern] = useState(false);
  // P1 — the one-shot dot-pop/flame-flicker (state change only, never
  // per visit): true only the first time this local date's own week-row
  // slot reads 'earned', gated by an in-memory tracker so a later focus
  // of Today the same day never replays it.
  const [glowOneShot, setGlowOneShot] = useState(false);
  // WL2 — warmth that arrived since last seen (server-gated); stays in
  // state for this visit's whisper even after the seen-marker advances,
  // so the lines don't vanish mid-read. The next focus refetches empty.
  const [warmth, setWarmth] = useState<FreshWarmth[]>([]);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    const today = getLocalDateString();
    try {
      const [profile, myCircles, myCircleCap, question, todayReflection, myGlow, myWeek, hasNotice, freshWarmth] = await Promise.all([
        getMyProfile(session.user.id),
        listMyCircles(session.user.id),
        getMyCircleCap(),
        getDailyQuestion(today),
        getTodayReflection(today),
        getMyGlow().catch(() => null),
        getMyWeek().catch(() => null),
        hasUnrespondedDayObservation(session.user.id).catch(() => false),
        // WL2 — ambient warmth; a failed fetch just means no whisper
        // this visit, never an error state.
        getFreshWarmth().catch(() => []),
      ]);
      setMyName(profile?.name ?? null);
      setMyBirthday({
        month: profile?.birth_month ?? null,
        day: profile?.birth_day ?? null,
        celebrate: profile?.celebrate_birthday ?? true,
      });
      setHasSeenCheckinConsent(profile?.has_seen_checkin_consent ?? false);
      setHasSeenRemindersAsk(!!profile?.reminders_ask_seen_at);
      setHasSeenPhotoAsk(!!profile?.photo_ask_seen_at);
      setMyAvatarUrl(profile?.avatar_url ?? null);
      setCircles(myCircles);
      setCircleCap(myCircleCap);
      setReflectionQuestion(question);
      setHasWrittenReflectionToday(!!todayReflection && isReflectionSubstantive(todayReflection));
      setGlow(myGlow);
      setWeek(myWeek);
      setHasSurfacedPattern(hasNotice);
      setWarmth(freshWarmth);

      if (myCircles.length === 0) {
        setCircleData({});
        return;
      }

      const entries = await Promise.all(
        myCircles.map(async (c): Promise<[string, CircleData]> => {
          const [members, presence, lastCelebratedDay, mateGlows, teaser] = await Promise.all([
            getCircleMembers(c.id),
            getCirclePresence(c.id),
            getMyLastCelebratedDay(c.id, session.user.id),
            // GS1: the Who's Here glow ride-along — one batch call per
            // circle in the same Promise.all, never per member. Ambient
            // only; a failed fetch just means no flames this visit.
            getGlowForCircleMates(c.id).catch(() => new Map<string, number>()),
            // WL2 — the wall teaser's latest-line ride-along; same
            // ambient rule, a failed fetch just means no teaser.
            getWallTeaser(c.id, session.user.id).catch(() => null),
          ]);
          return [c.id, { members, presence, lastCelebratedDay, mateGlows, teaser }];
        })
      );
      setCircleData(Object.fromEntries(entries));
      // AV1 — the photo ask's gate: the user's first check-in has been
      // celebrated (any completions row of theirs, self or covered, in
      // a current circle).
      setHasAnyOwnCompletion(
        entries.some(([, data]) => data.presence.some((p) => p.userId === session.user.id))
      );

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
    } catch {
      // ER1: the warm line, never the raw message (warmth law).
      setError(STRINGS.loadFailedLine('your circles'));
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

  // P1 — the one-shot dot-pop/flame-flicker: fires exactly once, the
  // first time this local date's own week-row slot reads 'earned'
  // (typically the very next Today render after a check-in). A later
  // focus of Today the same day finds the date already marked played
  // and does nothing, so it never replays per visit.
  useEffect(() => {
    if (!week || week.length === 0) return;
    const todayRow = week[week.length - 1];
    if (todayRow.state !== 'earned') return;
    if (hasPlayedTodayOneShot('glow', todayRow.date)) return;
    markTodayOneShotPlayed('glow', todayRow.date);
    setGlowOneShot(true);
  }, [week]);

  // WL2 — the whisper fades once seen: the FIRST actual render of fresh
  // warmth consumes it (marker moves to the newest SHOWN row's own
  // timestamp, so later arrivals stay fresh). Gated on the loading and
  // redirect flags so warmth is never consumed by a Today pass the user
  // never saw (e.g. the welcome-back redirect). The rows stay in state
  // for this visit; the next focus refetches empty and the whisper is
  // gone — never a badge, never an accumulating count.
  const markedWarmthRef = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading || isRedirecting || warmth.length === 0 || !session?.user) return;
    const newest = warmth[0].createdAt;
    if (markedWarmthRef.current === newest) return;
    markedWarmthRef.current = newest;
    markWarmthSeen(session.user.id, newest).catch(() => {
      // low-stakes: worst case the same warmth whispers once more
    });
  }, [isLoading, isRedirecting, warmth, session?.user?.id]);

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
              mateGlows: prev[id]?.mateGlows ?? new Map<string, number>(),
              teaser: prev[id]?.teaser ?? null,
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
    const wantsTimerWithDuration = wantsTimer && !!circle.durationMinutes;
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
          ...(circle.durationMinutes
            ? { durationMinutes: String(circle.durationMinutes) }
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
      <Text style={styles.addCircleLinkText}>+ add a circle</Text>
    </TouchableOpacity>
  );

  // BD1 — the user's own birthday moment, shown across every Today branch
  // (only when they've kept the celebrate toggle on). Resolved against the
  // device's own local date, which is this user's local date.
  const isMyBirthday = myBirthday.celebrate && isBirthdayToday(myBirthday.month, myBirthday.day, today);
  const birthdayBanner = isMyBirthday ? <BirthdayBanner name={myName} /> : null;

  // WL2 — the "for you" whisper: quiet lines under the header, only
  // when warmth arrived since last seen; absent entirely otherwise.
  const whisperDecision = buildWhisperLines(warmth);
  const warmthWhisper = whisperDecision ? (
    <View style={styles.whisperWrap}>
      {whisperDecision.lines.map((w) => (
        <Text key={`${w.createdAt}-${w.senderName}-${w.kind}`} style={styles.whisperLine}>
          {w.kind === 'heart'
            ? STRINGS.warmthWhisperHeart(w.senderName)
            : STRINGS.warmthWhisperWave(w.senderName)}
        </Text>
      ))}
      {whisperDecision.overflowCount > 0 && (
        <Text style={styles.whisperLine}>{STRINGS.warmthWhisperOverflow}</Text>
      )}
    </View>
  ) : null;

  // RM1 — the one-time dismissible reminders-ask card for existing users
  // (new sign-ups get the onboarding step instead, never both). Either
  // action hides it immediately and stamps the flag for good; a failed
  // stamp is low-stakes (the card just might show once more).
  const handleTurnOnReminders = () => {
    if (!session?.user) return;
    setHasSeenRemindersAsk(true);
    updateNotificationPrefs(session.user.id, { nudgeEnabled: true, digestEnabled: true }).catch(() => {});
    markRemindersAskSeen(session.user.id).catch(() => {});
  };
  const handleMaybeLaterReminders = () => {
    if (!session?.user) return;
    setHasSeenRemindersAsk(true);
    markRemindersAskSeen(session.user.id).catch(() => {});
  };
  const remindersAskCard = !hasSeenRemindersAsk ? (
    <RemindersAskCard variant="compact" onTurnOn={handleTurnOnReminders} onMaybeLater={handleMaybeLaterReminders} />
  ) : null;

  // AV1 — the one-shot photo ask: photo-less account, never seen it,
  // first check-in celebrated. Any interaction stamps it forever (a
  // failed stamp is low-stakes — the card just might show once more).
  // Never stacked under the RM1 card: reminders keeps priority and the
  // photo ask simply waits for a later visit.
  const handlePhotoAskAdd = () => {
    if (!session?.user) return;
    setHasSeenPhotoAsk(true);
    markPhotoAskSeen(session.user.id).catch(() => {});
    router.push('/settings');
  };
  const handlePhotoAskDismiss = () => {
    if (!session?.user) return;
    setHasSeenPhotoAsk(true);
    markPhotoAskSeen(session.user.id).catch(() => {});
  };
  const photoAskCard =
    !hasSeenPhotoAsk && !myAvatarUrl && hasAnyOwnCompletion && hasSeenRemindersAsk && session?.user ? (
      <PhotoAskCard
        userId={session.user.id}
        onAddPhoto={handlePhotoAskAdd}
        onKeepPenguin={handlePhotoAskDismiss}
      />
    ) : null;

  // ---- zero circles: nothing to show but a way back in ----
  if (circles.length === 0) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
        <AppHeader hideHouse style={styles.topbar} />
        <Text style={styles.greeting}>{greeting(myName)}</Text>
        <GlowBadge glow={glow} flickerOnce={glowOneShot} />
        {birthdayBanner}
        {warmthWhisper}
        {remindersAskCard}
        {photoAskCard}
        {/* ER1: only a real failure gets the slip — the no-circle case
            is a neutral empty state, not an apology. */}
        {error ? (
          <ErrorSlip message={error} />
        ) : (
          <Text style={styles.subtitle}>you&apos;re not in a circle yet</Text>
        )}
        {addCircleButton}
      </ScrollView>
    );
  }

  // ---- exactly one circle: identical to the pre-multi-circle Today ----
  if (circles.length === 1) {
    const circle = circles[0];
    const data =
      circleData[circle.id] ??
      { members: [], presence: [], lastCelebratedDay: 0, mateGlows: new Map<string, number>(), teaser: null };
    const { members, presence, mateGlows } = data;
    const inTodayUserIds = new Set(
      presence.filter((p) => p.localDate === today).map((p) => p.userId)
    );
    const iAmCheckedInToday = !!session?.user && inTodayUserIds.has(session.user.id);
    const iWasCoveredToday = presence.find(
      (p) => p.localDate === today && p.userId === session?.user?.id && p.kind === 'covered'
    );
    const inCount = inTodayUserIds.size;
    // RS1/RS2 — every "N of M" headcount line counts only non-resting,
    // non-away members in M (they're still real members, just quietly
    // at the edge for now); the circle screen owns the actual visual
    // fade/sleeping badge, this screen's own member row is untouched
    // per RS1's scope.
    const activeMemberCount = attachRestingStatus(members, presence, today).filter(
      (m) => !m.isResting && !m.awaySince
    ).length;
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
        <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
          <AppHeader hideHouse style={styles.topbar} />
          <Text style={styles.greeting}>{greeting(myName)}</Text>
          <GlowBadge
            glow={glow}
            coveredByName={iWasCoveredToday ? memberFullName(members, iWasCoveredToday.coveredBy) : null}
            flickerOnce={glowOneShot}
          />
          {birthdayBanner}
          {warmthWhisper}
          {remindersAskCard}
          {photoAskCard}
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
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
        <AppHeader hideHouse style={styles.topbar} />

        <Text style={styles.greeting}>{greeting(myName)}</Text>
        <GlowBadge glow={glow} coveredByName={iWasCoveredToday ? memberFullName(members, iWasCoveredToday.coveredBy) : null} />
        {birthdayBanner}
        {warmthWhisper}
        {remindersAskCard}
        {photoAskCard}

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
                  inCount === activeMemberCount
                    ? STRINGS.groupAllInCelebration(activeMemberCount, circle.name)
                    : STRINGS.cardLinkStatus(inCount, activeMemberCount)
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
                  {/* AV1 — tapping YOUR OWN placeholder penguin (never
                      someone else's, never a photo) opens the photo
                      upload in settings. This strip had no avatar tap
                      before, so nothing is stolen. */}
                  {isMe && !member.avatarUrl ? (
                    <TouchableOpacity
                      onPress={() => router.push('/settings')}
                      accessibilityLabel={STRINGS.ownPenguinTapA11yLabel}
                    >
                      <Avatar name={member.name} userId={member.userId} avatarUrl={member.avatarUrl} size={42} ring={state} />
                    </TouchableOpacity>
                  ) : (
                    <Avatar name={member.name} userId={member.userId} avatarUrl={member.avatarUrl} size={42} ring={state} />
                  )}
                  <CheckedInBadge state={state} />
                </View>
                <Text style={styles.memberName} numberOfLines={1}>
                  {isMe ? 'You' : member.name ?? 'circle-mate'}
                </Text>
                {/* GS1 — ambient pride from 7 days; away members never
                    reach the map (server-excluded). Absent below 7. */}
                {!member.awaySince && mateGlows.has(member.userId) && (
                  <Text
                    style={styles.glowFlameLine}
                    accessibilityLabel={STRINGS.glowFlameA11yLabel(member.name ?? 'circle-mate', mateGlows.get(member.userId)!)}
                  >
                    🔥 {mateGlows.get(member.userId)}
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        {/* WL2 — the wall teaser: one quiet line, only when the wall
            holds something newer than this member's last visit; silent
            otherwise (never permanent chrome — TB1's no-duplicate-doors
            rule). */}
        {data.teaser && isWallTeaserFresh(data.teaser, circle.wallSeenAt) && (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/wall', params: { circleId: circle.id } })}
          >
            <Text style={styles.wallTeaserLine} numberOfLines={1}>
              {data.teaser.kind === 'post'
                ? STRINGS.wallTeaserPost(memberFullName(members, data.teaser.userId), truncate(data.teaser.body, 46))
                : STRINGS.wallTeaserCelebration(truncate(data.teaser.body, 56))}
            </Text>
          </TouchableOpacity>
        )}

        {iWasCoveredToday ? (
          <View style={styles.coveredNoteCard}>
            <Text style={styles.coveredNoteText}>
              {STRINGS.coveredNoteToCoveredMember(memberFullName(members, iWasCoveredToday.coveredBy))}
            </Text>
          </View>
        ) : !iAmCheckedInToday && circle.durationMinutes && !circle.resourceUrl ? (
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

        <TodayFooter week={week} hasSurfacedPattern={hasSurfacedPattern} oneShotEarned={glowOneShot} />

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
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
      <AppHeader hideHouse style={styles.topbar} />

      <Text style={styles.greeting}>{greeting(myName)}</Text>
      <GlowBadge glow={glow} coveredByName={coveredTodayName} flickerOnce={glowOneShot} />
      {birthdayBanner}
      {warmthWhisper}
      {remindersAskCard}
      {photoAskCard}

      <Text style={styles.headline}>
        {CIRCLE_COUNT_WORD[circles.length] ?? circles.length} small things{' '}
        <Text style={styles.headlineAccent}>today</Text>
      </Text>

      {circles.map((circle) => {
        const data =
          circleData[circle.id] ??
          { members: [], presence: [], lastCelebratedDay: 0, mateGlows: new Map<string, number>(), teaser: null };
        const { members, presence, mateGlows } = data;
        const inTodayUserIds = new Set(
          presence.filter((p) => p.localDate === today).map((p) => p.userId)
        );
        const iAmCheckedInToday = !!session?.user && inTodayUserIds.has(session.user.id);
        const iWasCoveredToday = presence.find(
          (p) => p.localDate === today && p.userId === session?.user?.id && p.kind === 'covered'
        );
        const inCount = inTodayUserIds.size;
        // RS1/RS2 — see the single-circle branch above for the full note.
        const activeMemberCount = attachRestingStatus(members, presence, today).filter(
          (m) => !m.isResting && !m.awaySince
        ).length;
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
                  inCount === activeMemberCount
                    ? STRINGS.groupAllInCelebration(activeMemberCount, circle.name)
                    : STRINGS.cardLinkStatus(inCount, activeMemberCount)
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
                      {/* AV1 — same own-penguin tap as the single-circle
                          strip. */}
                      {isMe && !member.avatarUrl ? (
                        <TouchableOpacity
                          onPress={() => router.push('/settings')}
                          accessibilityLabel={STRINGS.ownPenguinTapA11yLabel}
                        >
                          <Avatar name={member.name} userId={member.userId} avatarUrl={member.avatarUrl} size={38} ring={state} />
                        </TouchableOpacity>
                      ) : (
                        <Avatar name={member.name} userId={member.userId} avatarUrl={member.avatarUrl} size={38} ring={state} />
                      )}
                      <CheckedInBadge state={state} />
                    </View>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {isMe ? 'You' : member.name ?? 'circle-mate'}
                    </Text>
                    {/* GS1 — same ambient flame as the single-circle strip. */}
                    {!member.awaySince && mateGlows.has(member.userId) && (
                      <Text
                        style={styles.glowFlameLine}
                        accessibilityLabel={STRINGS.glowFlameA11yLabel(member.name ?? 'circle-mate', mateGlows.get(member.userId)!)}
                      >
                        🔥 {mateGlows.get(member.userId)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>

            {/* WL2 — same one-line wall teaser as the single-circle
                branch, per stacked card. */}
            {data.teaser && isWallTeaserFresh(data.teaser, circle.wallSeenAt) && (
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/wall', params: { circleId: circle.id } })}
              >
                <Text style={styles.wallTeaserLine} numberOfLines={1}>
                  {data.teaser.kind === 'post'
                    ? STRINGS.wallTeaserPost(memberFullName(members, data.teaser.userId), truncate(data.teaser.body, 46))
                    : STRINGS.wallTeaserCelebration(truncate(data.teaser.body, 56))}
                </Text>
              </TouchableOpacity>
            )}

            {iWasCoveredToday ? (
              <View style={styles.coveredNoteCard}>
                <Text style={styles.coveredNoteText}>
                  {STRINGS.coveredNoteToCoveredMember(memberFullName(members, iWasCoveredToday.coveredBy))}
                </Text>
              </View>
            ) : !iAmCheckedInToday && circle.durationMinutes && !circle.resourceUrl ? (
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

      <TodayFooter week={week} hasSurfacedPattern={hasSurfacedPattern} />
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
    // TB3: the pill clearance is inset-aware, applied inline at each
    // ScrollView via useTabBarClearance().
  },
  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
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
  // GS1 — the ambient flame under a glowing member's name. Quiet by
  // design; simply absent below 7 days.
  glowFlameLine: {
    fontSize: 9,
    color: colors.muted,
    marginTop: 1,
  },
  // WL2 — the "for you" whisper: quiet, small, warm; compact stack when
  // several arrived. Never a badge shape, never a count.
  whisperWrap: {
    marginBottom: 10,
    gap: 2,
  },
  whisperLine: {
    fontSize: 12.5,
    color: colors.ink,
  },
  // WL2 — the wall teaser: one muted line under the members, the same
  // quiet-navigation register as "This week" (ink/muted, never green).
  wallTeaserLine: {
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 2,
    marginBottom: 10,
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
  addCircleLink: {
    marginTop: 22,
    alignItems: 'center',
  },
  addCircleLinkText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.green,
  },
});
