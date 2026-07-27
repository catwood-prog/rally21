import { withErrorBoundary } from '@/components/ErrorBoundary';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
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
import { MessageDialog } from '@/components/MessageDialog';
import { PhotoAskCard } from '@/components/PhotoAskCard';
import { RemindersAskCard } from '@/components/RemindersAskCard';
import { SignalMeter } from '@/components/SignalMeter';
import { TodayFooter } from '@/components/TodayFooter';
import { TodayNotificationSpot } from '@/components/TodayNotificationSpot';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { isVerbPhrasePractice, STRINGS } from '@/constants/strings';
import { cardShadow, chipTextShape, colors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useAuth } from '@/lib/auth-context';
import { getMyCircleCap, MAX_CIRCLES } from '@/lib/caps';
import {
  DailyQuestion,
  getDailyQuestion,
  getTodayReflection,
  isReflectionSubstantive,
  recordCheckinWithoutReflection,
  resolveCheckinRoute,
} from '@/lib/checkin';
import { unlockAudioContext } from '@/lib/chime';
import {
  attachRestingStatus,
  CircleMember,
  CirclePresenceRow,
  getCircleMembers,
  getCirclePresence,
  isSoloCircle,
  listMyCircles,
  MyCircle,
  subscribeToCirclePresence,
} from '@/lib/circle';
import { isBirthdayToday } from '@/lib/birthday';
import { daysBetween, getLocalDateString, shiftDate } from '@/lib/date';
import { getGlowForCircleMates, getMyGlow, getMyWeek, Glow, WeekDay } from '@/lib/glow';
import { getMyLastCelebratedDay, getNextMilestone } from '@/lib/journey';
import { shouldRouteToJourneyGate } from '@/lib/journeyGateGuard';
import { updateNotificationPrefs } from '@/lib/notifications';
import { buildNotificationSpot, CoverMoment, shouldMoveSpotBelowCta } from '@/lib/notificationSpot';
import { getMyProfile, markPhotoAskSeen, markReentryAcknowledged, markRemindersAskSeen } from '@/lib/profile';
import { isDesiredChange, isObstacle, OBSTACLE_KEYS, setKeepGoingObstacle } from '@/lib/onboardingIntake';
import { hasUnrespondedDayObservation } from '@/lib/reflections';
import { computeSignal } from '@/lib/signal';
import { hasPlayedTodayOneShot, markTodayOneShotPlayed } from '@/lib/todayOneShot';
import {
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
  // TN1 — the fuller row shape (it carries created_at), since the
  // notification spot's cover moment needs the row's insert time, not
  // just the day it covers. computeSignal still takes it as a PresenceRow.
  presence: CirclePresenceRow[];
  lastCelebratedDay: number;
  // GS1 — circle-mates at 7+ days glowing (server-floored), by user id.
  mateGlows: Map<string, number>;
  // WL2 — the latest wall line someone else left (post or celebration),
  // for the one-line teaser under the members; null = nothing to tease.
  teaser: WallTeaserItem | null;
};

function Today() {
  const router = useRouter();
  const { session } = useAuth();
  // TB3 — inset-aware pill clearance; applied to every state's scroll.
  const tabBarClearance = useTabBarClearance();
  // AR3 — TN1's fold gap, Cat's ruling: the spot must never push the
  // check-in CTA below the fold, and it REORDERS to obey rather than
  // shedding warmth (lib/notificationSpot.ts's shouldMoveSpotBelowCta
  // carries the whole argument, including why the old shed is gone).
  // Three measurements feed that one decision. They live in refs, not
  // state, because only their VERDICT should ever cause a re-render — a
  // layout pass that changes nothing must not loop.
  const [spotBelowCta, setSpotBelowCta] = useState(false);
  const viewportHeight = useRef(0);
  const spotBlockHeight = useRef(0);
  const ctaBottom = useRef(0);
  // Which arrangement `ctaBottom` was MEASURED in. This has to be
  // recorded at measurement time, not read at decision time, because on
  // react-native-web onLayout is backed by a ResizeObserver: it fires
  // when a box changes SIZE, and not when it merely MOVES. So after the
  // spot relocates, the CTA slides up the screen and reports nothing —
  // the stored number still describes the old arrangement. Reading the
  // CURRENT arrangement to interpret a STALE measurement is what made
  // this flip-flop (296 recomputes at one viewport before the fix):
  // it added the spot's height to a number that had never had it
  // subtracted. Native does fire onLayout on a move, so both platforms
  // are correct with the frame stored alongside the number.
  const ctaMeasuredWithSpotAbove = useRef(true);
  // The live arrangement, readable from a layout callback without making
  // that callback depend on (and be recreated by) the state itself.
  const spotBelowCtaRef = useRef(false);
  spotBelowCtaRef.current = spotBelowCta;

  const reconsiderSpotOrder = useCallback(() => {
    // Normalise to the one frame the predicate is defined in, using the
    // frame this measurement actually came from.
    const ctaBottomWithSpotAbove = ctaMeasuredWithSpotAbove.current
      ? ctaBottom.current
      : ctaBottom.current + spotBlockHeight.current;
    setSpotBelowCta(
      shouldMoveSpotBelowCta({
        viewportHeight: viewportHeight.current,
        ctaBottomWithSpotAbove,
        spotBlockHeight: spotBlockHeight.current,
      })
    );
  }, []);

  const onScrollLayout = useCallback(
    (e: LayoutChangeEvent) => {
      viewportHeight.current = e.nativeEvent.layout.height;
      reconsiderSpotOrder();
    },
    [reconsiderSpotOrder]
  );
  // Measured on a wrapper so the card's own marginBottom is included —
  // that margin travels with the spot, so it is part of what moving it
  // gives back.
  const onSpotLayout = useCallback(
    (e: LayoutChangeEvent) => {
      spotBlockHeight.current = e.nativeEvent.layout.height;
      reconsiderSpotOrder();
    },
    [reconsiderSpotOrder]
  );
  // y is relative to the parent, so this wrapper has to be a direct child
  // of the scroll content container for y to mean "content offset".
  const onCtaLayout = useCallback(
    (e: LayoutChangeEvent) => {
      ctaBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height;
      ctaMeasuredWithSpotAbove.current = !spotBelowCtaRef.current;
      reconsiderSpotOrder();
    },
    [reconsiderSpotOrder]
  );
  const [circles, setCircles] = useState<MyCircle[]>([]);
  const [circleData, setCircleData] = useState<Record<string, CircleData>>({});
  const [myName, setMyName] = useState<string | null>(null);
  const [myBirthday, setMyBirthday] = useState<{ month: number | null; day: number | null; celebrate: boolean }>({
    month: null,
    day: null,
    celebrate: true,
  });
  const [hasSeenCheckinConsent, setHasSeenCheckinConsent] = useState(true);
  // SK1 — "just check-ins for me". Defaults FALSE so Today never renders
  // the one-tap flow before the real value loads; a wrong guess here
  // would skip someone's reflection screen without being asked.
  const [reflectionsOptOut, setReflectionsOptOut] = useState(false);
  // SK1 job 3 — the circle whose one-tap check-in is in flight, so the
  // CTA can't be double-tapped into two saves, plus its own failure
  // surface (the flow has no screen of its own to fail on).
  const [oneTapCircleId, setOneTapCircleId] = useState<string | null>(null);
  const [checkinError, setCheckinError] = useState<string | null>(null);
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
  // ON1 — Q1's stored answer (drives the Day-0 sentence's opening); and a
  // session-local flag so a skipped Q2 card doesn't reappear this visit.
  const [desiredChange, setDesiredChange] = useState<string | null>(null);
  const [obstacleDismissed, setObstacleDismissed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
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
  // state for this visit's spot even after the seen-marker advances, so
  // the lines don't vanish mid-read. The next focus refetches empty.
  const [warmth, setWarmth] = useState<FreshWarmth[]>([]);
  // TN1 — covers of the reader's own missed day that are fresh against
  // the SAME users.warmth_seen_at marker, and the re-entry moment the
  // spot's welcome-back mode reads. `reentry` holds the gap's last
  // completion date because acknowledging it (once, on render) is what
  // stops the moment repeating — there is no interstitial to tap now.
  const [covers, setCovers] = useState<CoverMoment[]>([]);
  const [reentry, setReentry] = useState<{ lastCompletionDate: string } | null>(null);

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
      setDesiredChange(profile?.onboarding_desired_change ?? null);
      setMyBirthday({
        month: profile?.birth_month ?? null,
        day: profile?.birth_day ?? null,
        celebrate: profile?.celebrate_birthday ?? true,
      });
      setHasSeenCheckinConsent(profile?.has_seen_checkin_consent ?? false);
      setReflectionsOptOut(profile?.reflections_opt_out ?? false);
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
      // TN1 — cleared up front so neither survives a refetch that ends
      // early (no circles) or in the catch below; both are set for real
      // once the per-circle entries land.
      setCovers([]);
      setReentry(null);

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

      // TN1 — the everyday cover moment. CV1 lands a cover on the covered
      // member's local YESTERDAY, so that is the only day the spot ever
      // reads; freshness comes from the same users.warmth_seen_at marker
      // waves and hearts are gated by (server-side, inside
      // get_my_fresh_warmth), so the spot has ONE freshness rule and no
      // second column. No marker readable = no cover line, rather than a
      // line that could repeat forever.
      const warmthSeenAt = profile?.warmth_seen_at ?? null;
      const yesterday = shiftDate(today, -1);
      setCovers(
        warmthSeenAt
          ? entries.flatMap(([, data]) =>
              data.presence
                .filter(
                  (p) =>
                    p.userId === session.user.id &&
                    p.kind === 'covered' &&
                    p.localDate === yesterday &&
                    new Date(p.createdAt).getTime() > new Date(warmthSeenAt).getTime()
                )
                .map((p) => ({
                  covererName: memberFullName(data.members, p.coveredBy),
                  at: p.createdAt,
                }))
            )
          : []
      );

      // "welcome back" shows once per gap of 2+ missed days, based on the
      // user's most recent completion across every circle — never on a
      // fresh start with no completions yet, and never twice for the same
      // gap once it's been acknowledged. TN1 (24 July): the DETECTION is
      // unchanged; only its destination moved. A returner now stays on
      // Today, one tap from checking in, and the moment renders as the
      // notification spot's welcome-back mode instead of an interstitial.
      const allMyDates = entries
        .flatMap(([, data]) => data.presence)
        .filter((p) => p.userId === session.user.id)
        .map((p) => p.localDate)
        .sort();
      const lastCompletionDate = allMyDates[allMyDates.length - 1];
      setReentry(
        lastCompletionDate &&
          daysBetween(lastCompletionDate, today) >= 3 &&
          profile?.last_reentry_ack_date !== lastCompletionDate
          ? { lastCompletionDate }
          : null
      );
    } catch {
      // ER1: the warm line, never the raw message (warmth law).
      setError(STRINGS.loadFailedLine('your circles'));
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

  // TN1 — Today's ONE notification surface. The whole render decision is
  // lib/notificationSpot.ts; this only feeds it. Null = nothing to say =
  // the spot is absent and Today is exactly its live layout (frame B).
  const spot = useMemo(
    () =>
      buildNotificationSpot({
        isReentry: !!reentry,
        warmth,
        covers,
        // A failed glow read means the truth is unknown, so the
        // re-entry sentence is omitted rather than guessed (OD1 job 14).
        glowHeld: glow ? glow.state === 'glowing' : null,
        circleCount: circles.length,
      }),
    [reentry, warmth, covers, glow, circles.length]
  );

  // WL2/TN1 — the spot fades once seen: the FIRST actual render of fresh
  // warmth consumes it (marker moves to the newest SHOWN moment's own
  // timestamp, so later arrivals stay fresh). Gated on the loading flag
  // so warmth is never consumed by a Today pass the user never saw. The
  // moments stay in state for this visit; the next focus refetches empty
  // and the spot is gone — never a badge, never an accumulating count.
  // `newestAt` spans covers as well as warmth, so a cover can't outlive
  // a marker that a newer wave already advanced past.
  const markedWarmthRef = useRef<string | null>(null);
  useEffect(() => {
    const newest = spot?.newestAt;
    if (isLoading || !newest || !session?.user) return;
    if (markedWarmthRef.current === newest) return;
    markedWarmthRef.current = newest;
    markWarmthSeen(session.user.id, newest).catch(() => {
      // low-stakes: worst case the same warmth shows once more
    });
  }, [isLoading, spot, session?.user?.id]);

  // TN1 — the re-entry moment is acknowledged on RENDER, since there is
  // no interstitial left to tap. Same idempotence as before (the gap's
  // own last-completion date), so a returner meets it exactly once.
  const ackedReentryRef = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading || !reentry || !session?.user) return;
    if (ackedReentryRef.current === reentry.lastCompletionDate) return;
    ackedReentryRef.current = reentry.lastCompletionDate;
    markReentryAcknowledged(session.user.id, reentry.lastCompletionDate).catch(() => {
      // best-effort — worst case the moment shows once more than intended
    });
  }, [isLoading, reentry, session?.user?.id]);

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
    if (isLoading || !circles.length) return;
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
      // CB1 job 1b — shouldRouteToJourneyGate, never shouldShowJourneyGate:
      // Today is where the ceremony's exit lands, so routing on
      // eligibility ALONE is what let the cycle close when the marker
      // write failed. Eligibility is unchanged; the guard is the extra.
      if (shouldRouteToJourneyGate(c.id, dayNumber, c, data.lastCelebratedDay)) {
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
  }, [circles, circleData, isLoading, router]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  const today = getLocalDateString();
  // CV1 — a cover now lands on the covered member's local yesterday, so the
  // "{name} covered you for yesterday" note reads yesterday's covered row.
  const coveredDay = shiftDate(today, -1);
  const atCap = circles.length >= circleCap;

  // ON1 — record Q2's obstacle on the membership, then refetch so the card
  // gives way to the Day-0 reflected sentence.
  const answerObstacle = async (circleId: string, key: string) => {
    if (!isObstacle(key)) return;
    await setKeepGoingObstacle(circleId, key).catch(() => {});
    load();
  };

  // ON1 — the Day-0 intake's second half, on the first Today only. Q2 (the
  // obstacle) as one warm card while unanswered; once answered it gives way
  // to the reflected sentence that names the mechanic. Gated to a brand-new
  // person (no completions yet) who CREATED this circle — a solo creator is
  // still the creator, and an invited friend never is (JOB 4 is OWED), so
  // the invite loop stays clean and nothing here ever asks before joining.
  const onboardingIntakeBlock = (circle: MyCircle) => {
    if (hasAnyOwnCompletion || circle.createdBy !== session?.user?.id) return null;
    const obstacle = circle.keepGoingObstacle ?? null;

    if (obstacle && isObstacle(obstacle)) {
      const reflected = STRINGS.onboardingObstacleReflected[obstacle];
      const mechanic = STRINGS.onboardingReassurance[obstacle];
      const desiredPhrase = isDesiredChange(desiredChange)
        ? STRINGS.onboardingDayZeroDesiredPhrase[desiredChange]
        : null;
      const sentence = desiredPhrase
        ? STRINGS.onboardingDayZeroWithDesired(desiredPhrase, reflected, mechanic)
        : STRINGS.onboardingDayZeroSentence(reflected, mechanic);
      return (
        <View style={styles.dayZeroWrap}>
          <Text style={styles.dayZeroSentence}>{sentence}</Text>
        </View>
      );
    }

    if (obstacleDismissed) return null;
    return (
      <View style={styles.obstacleCard}>
        <Text style={styles.obstacleTitle}>{STRINGS.onboardingQ2Title}</Text>
        <Text style={styles.obstacleSubtitle}>{STRINGS.onboardingQ2Subtitle}</Text>
        {OBSTACLE_KEYS.map((k) => (
          <TouchableOpacity key={k} style={styles.obstacleOption} onPress={() => answerObstacle(circle.id, k)}>
            <Text style={styles.obstacleOptionText}>{STRINGS.onboardingObstacleLabels[k]}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.obstacleSkip} onPress={() => setObstacleDismissed(true)}>
          <Text style={styles.obstacleSkipText}>{STRINGS.onboardingSkip}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // SK1 job 3 — the one-tap check-in. The day is recorded right here and
  // the person lands on the SAME success beat a written check-in gets:
  // mascot, "You showed up again.", the glow update, and then everything
  // downstream of that screen unchanged — glow beat, milestone beat and
  // the share-card slot are all checkin-complete's own decisions, and it
  // makes them from the same `earnedToday` this passes.
  //
  // THE CEREMONY, traced rather than assumed (SK1's NOTE, 24 July): the
  // day-21 gate does NOT ride the check-in at all. today.tsx's own effect
  // fires it on load (shouldShowJourneyGate → /journey-gate, with the
  // rally-marker /celebration beat behind it), so it is reached the
  // moment this flow's dismissal lands back on Today, exactly as it is
  // after a written check-in. Nothing about the gate is hard-coded here,
  // and whatever that path becomes (the personal rally ceremony) this
  // flow keeps meeting it for free.
  const recordOneTapCheckin = async (circle: MyCircle) => {
    if (!session?.user || oneTapCircleId) return;
    setOneTapCircleId(circle.id);
    const userId = session.user.id;
    try {
      const { earnedToday } = await recordCheckinWithoutReflection({
        userId,
        circleId: circle.id,
        localDate: getLocalDateString(),
      });
      router.push({
        pathname: '/checkin-complete',
        params: { circleId: circle.id, ...(earnedToday ? { earnedToday: 'true' } : {}) },
      });
    } catch {
      // A one-tap check-in has no screen of its own to fail on, so the
      // failure has to be said out loud here — silence would read as "the
      // button doesn't work". ER1's warm line, never the raw message.
      setCheckinError(STRINGS.loadFailedLine('your check-in'));
    } finally {
      setOneTapCircleId(null);
    }
  };

  const goToCheckin = (circle: MyCircle, wantsTimer: boolean, dayNumber: number) => {
    const wantsTimerWithDuration = wantsTimer && !!circle.durationMinutes;
    // A circle's resource link (video or otherwise) always routes through
    // the activity screen — it's the hero of that screen regardless of
    // whether the user tapped "start timer" or not (see checkin-timer.tsx).
    const goesToActivityScreen = !!circle.resourceUrl || wantsTimerWithDuration;

    const route = resolveCheckinRoute({
      hasSeenCheckinConsent,
      goesToActivityScreen,
      reflectionsOptOut,
    });

    // Must happen synchronously inside this tap — iOS Safari only unlocks
    // audio playback for an AudioContext created/resumed directly inside a
    // user gesture, not after any awaited work. SK1: the one-tap flow
    // lands straight on checkin-complete, which plays the check-in pop (or
    // hands off to the glow beat's bowl), so it needs the unlock too.
    if (goesToActivityScreen || route === 'one-tap') unlockAudioContext();

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

    if (route === 'intro') {
      router.push({ pathname: '/checkin-intro', params: { circleId: circle.id, ...activityParams } });
    } else if (route === 'activity') {
      router.push({ pathname: '/checkin-timer', params: { circleId: circle.id, ...activityParams } });
    } else if (route === 'one-tap') {
      recordOneTapCheckin(circle);
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
      <Text style={styles.addCircleLinkText}>{STRINGS.addCircleLink}</Text>
    </TouchableOpacity>
  );

  // BD1 — the user's own birthday moment, shown across every Today branch
  // (only when they've kept the celebrate toggle on). Resolved against the
  // device's own local date, which is this user's local date.
  const isMyBirthday = myBirthday.celebrate && isBirthdayToday(myBirthday.month, myBirthday.day, today);
  const birthdayBanner = isMyBirthday ? <BirthdayBanner name={myName} /> : null;

  // TN1 — the notification spot, rendered in the slot WL2's whisper
  // held (above every ask, below the header) so it reads as the first
  // thing Today has to say. Renders nothing at all when `spot` is null.
  const notificationSpot = <TodayNotificationSpot content={spot} />;

  // AR3 — the spot renders in exactly ONE of two slots, never both. The
  // wrapper is what gets measured, so the card's own marginBottom counts
  // as part of what moving it gives back. When `spot` is null this is a
  // zero-height View and the reorder can never trigger.
  const measuredSpot = <View onLayout={onSpotLayout}>{notificationSpot}</View>;
  // Its normal home: above everything, the first thing Today has to say.
  const spotAboveCta = spotBelowCta ? null : measuredSpot;
  // Where it goes when it would otherwise push the CTA off the screen.
  const spotUnderCta = spotBelowCta ? measuredSpot : null;
  // For the branches that have NO check-in CTA (no circles, an archived
  // circle) and the stacked multi-circle branch, which does not carry the
  // below-slot: the spot always renders in its normal place, so a stale
  // measurement can never make it disappear.
  const spotAlways = measuredSpot;

  // SK1 job 3 — the one-tap flow's failure surface, shared by both
  // check-in-bearing branches. Deliberately 'plain', not ER1's slip:
  // Today can already be carrying a placed mascot (the photo ask), and
  // the one-mascot-per-screen law is never stacked.
  const checkinErrorDialog = (
    <MessageDialog
      visible={!!checkinError}
      title="hmm"
      message={checkinError ?? ''}
      onDismiss={() => setCheckinError(null)}
    />
  );

  // OD1 job 12a — Today used to hide its own failure. `error` was set on
  // any load failure but the ErrorSlip that renders it lives INSIDE the
  // zero-circle branch, so for everyone who actually has a circle — every
  // real user — a failed refresh left yesterday's numbers on screen
  // looking current. Today refetches on every focus, so a person could
  // read a stale headcount as today's attendance. That is a trust bug.
  //
  // 12b, DECIDED — KEEP the content and mark it as not current, rather
  // than replacing it. Today is the daily path: a refresh failure is
  // usually a moment of bad signal, and blanking the check-in button
  // because a refetch blinked would cost more than a stale headcount. So
  // the content stays and the screen says plainly that it is not fresh.
  // What is not allowed is stale data that looks live, and this is the
  // line that stops it.
  //
  // NOT ErrorSlip, deliberately, and this is the same call SK1 already
  // made three declarations above for checkinErrorDialog: ErrorSlip is
  // ER1's WHOLE-MOMENT surface and carries a mascot, and its own
  // docstring reserves it for that ("lines under live content stay
  // text-only by design") while the one-mascot-per-screen law forbids
  // stacking it over a placed mascot. Above live content the honest
  // surface is a line, not a slip. The zero-circle branch keeps its
  // ErrorSlip exactly as it was.
  //
  // The banner IS the retry: STRINGS.loadFailedLine already ends "give it
  // a moment and try again", so tapping the thing that says so re-runs
  // load() — no second control, and no new copy invented for it.
  const refreshFailedBanner =
    error && circles.length > 0 ? (
      <TouchableOpacity
        style={styles.refreshFailedBanner}
        onPress={load}
        accessibilityRole="button"
      >
        <Text style={styles.refreshFailedGlyph}>↻</Text>
        <Text style={styles.refreshFailedText}>{error}</Text>
      </TouchableOpacity>
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
        {spotAlways}
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
      (p) => p.localDate === coveredDay && p.userId === session?.user?.id && p.kind === 'covered'
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
    // OD1 job 16c — CAT'S RULING, 26 July, option (iv): a practice's
    // ORIGIN decides the sentence form, because the two kinds of name
    // carry different rights.
    //
    // OURS (seeded, practices.created_by is null — 57 of the 61 live
    // practices) keep "today you {name}" wherever isVerbPhrasePractice
    // says the name starts with a verb, lowercased exactly as before. We
    // wrote those names, so lowercasing them is safe and the warm
    // sentence rhythm survives untouched for almost every circle.
    //
    // THEIRS (user-created) always take the "today: {Name}" form and are
    // rendered EXACTLY AS TYPED. "today: Read before bed" and "today:
    // Meditate with Sam" both read correctly with their capital, so the
    // colon form buys fidelity at no cost to sense — which is why the
    // headline did NOT need restructuring for all 61 practices.
    //
    // This keeps the 5 July decision (7002b76: lowercase INSTEAD of
    // validating names at input) doing its real job — protecting the
    // sentence from a name we do not control — while honouring Cat's
    // 25 July law that user content is never re-cased. Note none of the
    // four live user-created names is actually damaged by lowercasing
    // today, so this closes a LATENT problem, not a live one.
    const isUserCreatedPractice = circle.practiceIsUserCreated;
    // A user-created name never enters the verb sentence, however much
    // it looks like a verb phrase.
    const useVerbSentence = isVerbPhrasePractice(practiceName) && !isUserCreatedPractice;
    const headlinePracticeName = isUserCreatedPractice ? practiceName : practiceName.toLowerCase();

    // A completed circle is warmly archived, read-only history — nothing
    // left to do today, so skip the check-in flow entirely and point
    // toward the circle screen's archive view instead.
    if (circle.completedAt) {
      return (
        <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
          <AppHeader hideHouse style={styles.topbar} />
          {/* OD1 job 12a — first thing under the header in every
              circles-present branch, so a stale screen says so before
              it says anything else. */}
          {refreshFailedBanner}
          <Text style={styles.greeting}>{greeting(myName)}</Text>
          <GlowBadge
            glow={glow}
            coveredByName={iWasCoveredToday ? memberFullName(members, iWasCoveredToday.coveredBy) : null}
            flickerOnce={glowOneShot}
          />
          {birthdayBanner}
          {spotAlways}
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
      // AR3 — onLayout here measures the fold itself: the scroll
      // viewport's own height, which is what the CTA has to fit inside.
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}
        onLayout={onScrollLayout}
      >
        <AppHeader hideHouse style={styles.topbar} />
        {/* OD1 job 12a — first thing under the header in every
            circles-present branch, so a stale screen says so before
            it says anything else. */}
        {refreshFailedBanner}

        <Text style={styles.greeting}>{greeting(myName)}</Text>
        <GlowBadge glow={glow} coveredByName={iWasCoveredToday ? memberFullName(members, iWasCoveredToday.coveredBy) : null} />
        {birthdayBanner}
        {spotAboveCta}
        {remindersAskCard}
        {photoAskCard}
        {onboardingIntakeBlock(circle)}

        <Text style={styles.headline}>
          {isSolo ? (
            useVerbSentence ? (
              <>
                today you <Text style={styles.headlineAccent}>{headlinePracticeName}</Text>
              </>
            ) : (
              <>
                today: <Text style={styles.headlineAccent}>{headlinePracticeName}</Text>
              </>
            )
          ) : useVerbSentence ? (
            <>
              today you{' '}
              <Text style={styles.headlineAccent}>{headlinePracticeName}</Text>
              {'\n'}with <Text style={styles.headlineAccent}>your circle</Text>
            </>
          ) : (
            <>
              today: <Text style={styles.headlineAccent}>{headlinePracticeName}</Text>,
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

        {/* TN1 — the "{name} covered you for yesterday" card moved INTO
            the notification spot (mockup frame C shows the cover line in
            the spot with the check-in button below it, unblocked). It
            used to sit here, in the CTA's own slot, which since CV1
            moved the cover to the covered member's local YESTERDAY meant
            a covered member arrived on Today the next day with no way to
            check in at all. The gift never takes the day away. */}
        {/* AR3 — the measured CTA. This wrapper must stay a DIRECT child
            of the scroll content container: onLayout's y is relative to
            the parent, and the reorder rule reads it as a content offset.
            The wrapper carries no style, so it changes no layout. */}
        <View onLayout={onCtaLayout}>
          {!iAmCheckedInToday && circle.durationMinutes && !circle.resourceUrl ? (
            <View style={styles.timerChoiceRow}>
              <TouchableOpacity
                style={styles.markDoneButton}
                onPress={() => goToCheckin(circle, false, signal.dayNumber)}
                disabled={oneTapCircleId === circle.id}
              >
                <Text style={styles.markDoneButtonText}>{STRINGS.markDoneCta}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.startTimerButton}
                onPress={() => goToCheckin(circle, true, signal.dayNumber)}
              >
                <Text style={styles.startTimerButtonText}>{STRINGS.startTimerCta}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // SK1 job 3 — "edit today's check-in" is a door to the
            // reflection screen, so an opted-out person who has already
            // checked in has nothing behind it. The CheckedInBadge on their
            // own avatar already says the day is done; offering an edit that
            // opens the form they turned off would be the pitch the no-nag
            // law forbids.
            (!iAmCheckedInToday || !reflectionsOptOut) && (
              <TouchableOpacity
                style={[styles.cta, iAmCheckedInToday && styles.ctaSecondary]}
                onPress={() => goToCheckin(circle, false, signal.dayNumber)}
                disabled={oneTapCircleId === circle.id}
              >
                <Text style={[styles.ctaText, iAmCheckedInToday && styles.ctaSecondaryText]}>
                  {iAmCheckedInToday ? STRINGS.editCheckinCta : STRINGS.checkInCta}
                </Text>
              </TouchableOpacity>
            )
          )}
        </View>

        {/* AR3 — the spot's other home. Warmth still arrives in full,
            just after the day's one action rather than in front of it. */}
        {spotUnderCta}

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
            <Text style={styles.inviteHintText}>{STRINGS.todayInviteHintLink}</Text>
          </TouchableOpacity>
        )}

        {/* NO-NAG LAW (SK1): the teaser is Today pitching tonight's
            reflection question. Once someone has opted out, Today never
            pitches again — the confirm card was the last unprompted word. */}
        {!reflectionsOptOut && !hasWrittenReflectionToday && reflectionQuestion && (
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
        {checkinErrorDialog}
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
      (p) => p.localDate === coveredDay && p.userId === session?.user?.id && p.kind === 'covered'
    );
    if (covered) {
      coveredTodayName = memberFullName(data.members, covered.coveredBy);
      break;
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
      <AppHeader hideHouse style={styles.topbar} />
      {/* OD1 job 12a — first thing under the header in every
          circles-present branch, so a stale screen says so before
          it says anything else. */}
      {refreshFailedBanner}

      <Text style={styles.greeting}>{greeting(myName)}</Text>
      <GlowBadge glow={glow} coveredByName={coveredTodayName} flickerOnce={glowOneShot} />
      {birthdayBanner}
      {spotAlways}
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
        // TN1 — this branch's own iWasCoveredToday went with the cover
        // note; the stack's GlowBadge reads coveredTodayName (computed
        // once above, across every circle) and the cover MOMENT reads in
        // the notification spot.
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

            {/* TN1 — same as the single-circle branch: the cover note
                moved into the notification spot and no longer occupies
                (and blocks) this circle's check-in slot. */}
            {!iAmCheckedInToday && circle.durationMinutes && !circle.resourceUrl ? (
              <View style={styles.timerChoiceRow}>
                <TouchableOpacity
                  style={styles.markDoneButton}
                  onPress={() => goToCheckin(circle, false, signal.dayNumber)}
                  disabled={oneTapCircleId === circle.id}
                >
                  <Text style={styles.markDoneButtonText}>{STRINGS.markDoneCta}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.startTimerButton}
                  onPress={() => goToCheckin(circle, true, signal.dayNumber)}
                >
                  <Text style={styles.startTimerButtonText}>{STRINGS.startTimerCta}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              // SK1 job 3 — same rule as the single-circle branch: no
              // "edit today's check-in" door for someone whose reflections
              // are off, since there is nothing behind it.
              (!iAmCheckedInToday || !reflectionsOptOut) && (
                <TouchableOpacity
                  style={[styles.cta, iAmCheckedInToday && styles.ctaSecondary]}
                  onPress={() => goToCheckin(circle, false, signal.dayNumber)}
                  disabled={oneTapCircleId === circle.id}
                >
                  <Text style={[styles.ctaText, iAmCheckedInToday && styles.ctaSecondaryText]}>
                    {iAmCheckedInToday ? STRINGS.editCheckinCta : STRINGS.checkInCta}
                  </Text>
                </TouchableOpacity>
              )
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
                <Text style={styles.inviteHintText}>{STRINGS.todayInviteHintLink}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      {addCircleButton}

      {/* NO-NAG LAW (SK1): silent once opted out — see the single-circle
          branch's note. */}
      {!reflectionsOptOut && !hasWrittenReflectionToday && reflectionQuestion && circles[0] && (
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
      {checkinErrorDialog}
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
  // OD1 job 12a — the stale-refresh strip. Quiet on purpose: it marks
  // content as not-current, it is not an apology and it must not compete
  // with the check-in CTA. Left-aligned row so the ↻ reads as the tap
  // (the strip itself re-runs load), and flexWrap so the line can grow
  // under large text without pushing the glyph off the edge.
  refreshFailedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  refreshFailedGlyph: {
    fontSize: 14,
    color: colors.ink,
  },
  refreshFailedText: {
    flexShrink: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.muted,
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
  // ON1 — the Day-0 Q2 card + the reflected sentence.
  obstacleCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    ...cardShadow,
  },
  obstacleTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 4,
  },
  obstacleSubtitle: {
    fontSize: 12.5,
    color: colors.muted,
    marginBottom: 12,
    lineHeight: 17,
  },
  obstacleOption: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 8,
  },
  obstacleOptionText: {
    fontSize: 14,
    color: colors.ink,
  },
  obstacleSkip: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 40,
    justifyContent: 'center',
  },
  obstacleSkipText: {
    fontSize: 12.5,
    color: colors.muted,
  },
  // Deliberately NOT plum: plum is the map's evidence-based "we noticed"
  // voice, and this is self-reported "you told us" (ON1 brand-integrity
  // scope edge) — a neutral warm card keeps the two voices apart.
  dayZeroWrap: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 15,
    marginBottom: 16,
    ...cardShadow,
  },
  dayZeroSentence: {
    fontSize: 14,
    color: colors.ink,
    lineHeight: 20,
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
    color: colors.greenText,
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
  // TN1 — the whisper's styles retired with it; the notification spot
  // owns its own look (components/TodayNotificationSpot.tsx).
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
  // TN1 — coveredNoteCard/coveredNoteText retired with the note itself;
  // the cover moment now reads in the notification spot.
  ctaText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  ctaSecondaryText: {
    fontWeight: '600',
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
    color: colors.greenText,
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
    color: colors.greenText,
  },
});

// NR1 Job 1c — this tab renders behind its own error boundary so a
// crash here can't take the floating tab bar (and the other tabs) down.
export default withErrorBoundary(Today, 'tab:today');
