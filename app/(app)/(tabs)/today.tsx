import { withErrorBoundary } from '@/components/ErrorBoundary';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Platform,
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
import { RemindersAskAlarmChoice, RemindersAskCard } from '@/components/RemindersAskCard';
import { SignalMeter } from '@/components/SignalMeter';
import { TodayFooter } from '@/components/TodayFooter';
import { TodayNotificationSpot } from '@/components/TodayNotificationSpot';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { isVerbPhrasePractice, STRINGS } from '@/constants/strings';
import { cardShadow, chipTextShape, colors } from '@/constants/theme';
import { useAddCircle } from '@/hooks/use-add-circle';
import { useCheckinLaunch } from '@/hooks/use-checkin-launch';
import { useOneTimeAskSlot } from '@/hooks/use-one-time-ask-slot';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { resolvePrefillAlarmTime, syncDailyReminder } from '@/lib/alarmReminder';
import { useAuth } from '@/lib/auth-context';
import { getMyCircleCap, MAX_CIRCLES } from '@/lib/caps';
import {
  DailyQuestion,
  getDailyQuestion,
  getTodayReflection,
  isReflectionSubstantive,
} from '@/lib/checkin';
import {
  attachRestingStatus,
  CircleMember,
  CirclePresenceRow,
  getCircleMembers,
  getCirclePresence,
  isSoloCircle,
  listMyCircles,
  MyCircle,
  selectFromMyCircles,
  subscribeToCirclePresence,
} from '@/lib/circle';
import { isBirthdayToday } from '@/lib/birthday';
import { daysBetween, getLocalDateString, shiftDate } from '@/lib/date';
import {
  getGlowForCircleMates,
  getMyFreshPebbleGifts,
  getMyGlow,
  getMyWeek,
  Glow,
  recordMyRallyCliff,
  WeekDay,
} from '@/lib/glow';
import { headcountLine } from '@/lib/headcount';
import { countRallyDays, getMyLastCelebratedDay, getNextMilestone, resumeMyRally } from '@/lib/journey';
import { shouldRouteToJourneyGate } from '@/lib/journeyGateGuard';
import { updateNotificationPrefs } from '@/lib/notifications';
import {
  buildNotificationSpot,
  CoverMoment,
  PebbleGiftMoment,
  shouldMoveSpotBelowCta,
} from '@/lib/notificationSpot';
import { getMyProfile, markPhotoAskSeen, markReentryAcknowledged, markRemindersAskSeen, setAlarmReminder } from '@/lib/profile';
import { isDesiredChange, isObstacle, OBSTACLE_KEYS, setKeepGoingObstacle } from '@/lib/onboardingIntake';
import { hasUnrespondedDayObservation } from '@/lib/reflections';
import { captureError } from '@/lib/sentry';
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

// WB1 job 1b — Today's one-time asks, named so the slot's priority list
// and the two render gates cannot drift apart on a typo.
const ASK_REMINDERS = 'reminders';
const ASK_PHOTO = 'photo';

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
  /** PA2 JOB 4 — null means NOT LOADED YET, never "zero". A ceremony
   * decision made on an invented 0 is how an answered ceremony re-fires
   * (CB1's trap, arriving through the realtime handler). */
  lastCelebratedDay: number | null;
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
  // PA2 — which circle's rally is mid-resume, so the link can show a
  // pending state without a second boolean per card.
  const [resumingCircleId, setResumingCircleId] = useState<string | null>(null);
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
  // SK1 job 3 — the flow has no screen of its own to fail on, so it needs
  // a failure surface here. (`oneTapCircleId`, which stops the CTA being
  // double-tapped into two saves, moved into useCheckinLaunch with the
  // flow itself — WB1 job 3.) This state is still Today's own: the resume
  // path below reports through it too.
  const [checkinError, setCheckinError] = useState<string | null>(null);
  // RM1 — defaults true so the card never flashes before the real value
  // loads; only ever matters once it resolves to false. This screen only
  // ever renders once onboarding is fully complete (see the (app) layout
  // gate), so a null flag here always means "existing user, never asked
  // yet" — a still-mid-onboarding account sees the onboarding step
  // instead (hooks/use-onboarding-status.ts's 'needs-reminders-ask').
  const [hasSeenRemindersAsk, setHasSeenRemindersAsk] = useState(true);
  // AL1 job 4 — the prefill rule's answer for THIS account, resolved once
  // the ask is actually going to show. Null until it lands, at which point
  // the card falls back to its own 08:00 no-guess default, which is the
  // same answer the rule gives when circles disagree.
  const [alarmPrefill, setAlarmPrefill] = useState<{ time: string; prefilled: boolean } | null>(null);
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
  // ON2 — Q2's answer now sits beside it on the profile rather than on
  // each membership: one obstacle per person, so one piece of state.
  const [desiredChange, setDesiredChange] = useState<string | null>(null);
  const [obstacle, setObstacle] = useState<string | null>(null);
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
  // PA3 job 3 — pebbles friends have put in this nest, gated server-side
  // against the same users.warmth_seen_at marker the covers use.
  const [pebbleGifts, setPebbleGifts] = useState<PebbleGiftMoment[]>([]);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    const today = getLocalDateString();
    try {
      const [profile, myCircles, myCircleCap, question, todayReflection, myGlow, myWeek, hasNotice, freshWarmth, freshPebbleGifts] = await Promise.all([
        getMyProfile(session.user.id),
        listMyCircles(session.user.id),
        getMyCircleCap(),
        getDailyQuestion(today),
        getTodayReflection(today),
        // FF1 rule 1, the three ambient reads at the top of Today, and
        // the reason each substitutes ABSENCE rather than a value:
        //   getMyGlow  -> null hides the GlowBadge entirely. Rule 2 is
        //     the binding one here: the glow is a person-facing NUMBER
        //     about their own streak, so a `?? 0` or `?? 1` would tell
        //     someone on day 40 they were on day 1. No badge says
        //     nothing; a wrong badge says something false.
        //   getMyWeek  -> null leaves the footer's week row and the
        //     glow's day dots unrendered, same reasoning: dots are a
        //     record of days, and an empty week reads as "you missed
        //     them all".
        //   hasUnrespondedDayObservation -> false hides the "something
        //     we noticed" link, the CONSERVATIVE direction (Cat, 28
        //     July): a link offered on a failed read lands on a screen
        //     with nothing on it.
        // None of the three feeds a write, and Today's own load failure
        // path (the catch below) still owns the case where the circle
        // data itself is missing.
        getMyGlow().catch(() => null),
        getMyWeek().catch(() => null),
        hasUnrespondedDayObservation(session.user.id).catch(() => false),
        // WL2 — ambient warmth; a failed fetch just means no whisper
        // this visit, never an error state.
        getFreshWarmth().catch(() => []),
        // PA3 — same shape and same reasoning as the warmth read above:
        // a failed fetch means no pebble line this visit. Substituting []
        // here is safe under FF1's rule because it feeds a MOMENT LINE,
        // not a write and not a number about the person — an absent line
        // says nothing false, where a fabricated one would.
        getMyFreshPebbleGifts().catch(() => []),
      ]);
      setMyName(profile?.name ?? null);
      setDesiredChange(profile?.onboarding_desired_change ?? null);
      setObstacle(profile?.keep_going_obstacle ?? null);
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
      setPebbleGifts(freshPebbleGifts);
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
                  // AU1 job 3b — the coverer's own identity rides along
                  // so the spot can draw their avatar like every other
                  // sender's. Both come from the members list already
                  // fetched for this circle; no extra read.
                  covererId: p.coveredBy,
                  covererName: memberFullName(data.members, p.coveredBy),
                  covererAvatarUrl:
                    data.members.find((m) => m.userId === p.coveredBy)?.avatarUrl ?? null,
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
        pebbleGifts,
        // PA3 job 2 — read from the SAME glow fetch as glowHeld below, so
        // a failed read cannot produce a pebble sentence either.
        pebbleHeldPlace: glow ? glow.heldByToday === 'pebble' : false,
        // A failed glow read means the truth is unknown, so the
        // re-entry sentence is omitted rather than guessed (OD1 job 14).
        glowHeld: glow ? glow.state === 'glowing' : null,
        circleCount: circles.length,
        // ON2 job C — the lean. The stored value is CHECK-constrained, so
        // this narrowing is belt-and-braces; anything unrecognised reaches
        // the spot as null and gets the neutral welcome line.
        obstacle: isObstacle(obstacle) ? obstacle : null,
      }),
    [reentry, warmth, covers, pebbleGifts, glow, circles.length, obstacle]
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

  // PA3 job 2 (memo §5.1) — a run that ended keeps its record. The glow
  // READS stay side-effect-free, so the durable journal fact is written
  // by this explicit call, following check_glow_milestone's shipped
  // detect-and-write pattern. Idempotent at the database (a partial
  // unique index on the break date), so however many times Today loads
  // after a run ended there is exactly one fact for it.
  //
  // Fired only when the glow is actually cold — no call on the ordinary
  // path, where there is nothing to record.
  const recordedCliffRef = useRef(false);
  useEffect(() => {
    if (isLoading || !session?.user || glow?.state !== 'cold') return;
    if (recordedCliffRef.current) return;
    recordedCliffRef.current = true;
    recordMyRallyCliff().catch((e) => {
      // Reported, never swallowed (FF1 rule 3): this is a durable WRITE,
      // and a lost longest-rally record is the one thing memo §5.1
      // promises survives the loss.
      captureError(e, { screen: 'today', op: 'recordMyRallyCliff' });
    });
  }, [isLoading, glow?.state, session?.user?.id]);

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
              // PA2 JOB 4 (routed here from CB1, 25 July) — this used to
              // read `?? 0`. It is the same defect class CB1 closed on
              // the circle screen: a realtime presence event can arrive
              // for a circle whose entry has not been built yet (a
              // circle-mate checks in during the initial load), and the
              // old default invented "this member has celebrated
              // nothing" out of "we have not looked yet". Fed straight
              // into shouldRouteToJourneyGate, an invented 0 is exactly
              // what re-fires an already-answered ceremony.
              //
              // null now means UNKNOWN, and the gate effect below skips
              // any circle whose marker is unknown rather than guessing
              // at it. The real value lands on the next load().
              lastCelebratedDay: prev[id]?.lastCelebratedDay ?? null,
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
    if (isLoading || !circles.length || !session?.user) return;
    const userId = session.user.id;
    for (const c of circles) {
      const data = circleData[c.id];
      if (!data) continue;
      // PA2 JOB 4 — CB1's rule, now enforced on Today too: never decide a
      // ceremony on a marker that has not arrived. Skip, don't guess.
      if (data.lastCelebratedDay === null) continue;
      // PA1 — the ceremony and the milestones now key off THIS member's
      // rally count (practices they did in THIS circle), never the
      // circle's age. `data.presence` is the circle's full completion
      // history, already loaded, so this costs no extra fetch. A count
      // of 0 (presence not in yet) simply fires nothing — the safe
      // direction, and the effect re-runs when the rows land.
      const rallyCount = countRallyDays(data.presence, userId);
      // CB1 job 1b — shouldRouteToJourneyGate, never shouldShowJourneyGate:
      // Today is where the ceremony's exit lands, so routing on
      // eligibility ALONE is what let the cycle close when the marker
      // write failed. Eligibility is unchanged; the guard is the extra.
      // PA2 — a member who has FINISHED their rally here gets neither
      // the first-rally ceremony nor the later milestone beats. They
      // ended this rally; the app does not keep celebrating it at them.
      if (c.myFinishedAt) continue;
      if (shouldRouteToJourneyGate(c.id, rallyCount, c, data.lastCelebratedDay, c.myFinishedAt)) {
        router.push({ pathname: '/journey-gate', params: { circleId: c.id } });
        return;
      }
      // PA2 — the `c.ralliedOnAt &&` condition is GONE, for the same
      // reason as on the circle screen: rally markers and major stops
      // are PERSONAL now, so gating them on a circle-level flag nothing
      // writes any more would switch every later celebration off.
      if (!c.completedAt) {
        const milestone = getNextMilestone(rallyCount, data.lastCelebratedDay);
        if (milestone) {
          router.push({
            pathname: '/celebration',
            params: { circleId: c.id, day: String(milestone.day), isMajorStop: String(milestone.isMajorStop) },
          });
          return;
        }
      }
    }
  }, [circles, circleData, isLoading, router, session?.user?.id]);

  // AL1 job 4 — the personal practice time's prefill, resolved only once
  // the ask is actually going to show, so the overwhelming majority of
  // Today loads (every account that has already answered) pay nothing for
  // it. Web never asks at all.
  //
  // BG1 (1 Aug) — THIS HOOK LIVES HERE, ABOVE THE LOADING EARLY RETURN,
  // AND SO MUST EVERY HOOK ADDED TO THIS SCREEN. It shipped below it, next
  // to the reminders card it feeds, which read as the tidy place to put it
  // — but Today's first render always takes the `if (isLoading)` return
  // below, so a hook underneath it is called on the loaded render and NOT
  // on the loading one. React counts hooks per render: 53 then 54, and it
  // throws "Rendered more hooks than during the previous render." Today's
  // own error boundary caught it (the tab bar survived, which is why it
  // read as a data bug), and it fired for EVERY account on BOTH platforms
  // from the moment AL1 went live. The card, its handlers and its copy stay
  // where they are; only the hook had to move.
  useEffect(() => {
    if (Platform.OS === 'web' || hasSeenRemindersAsk || !session?.user) return;
    resolvePrefillAlarmTime(session.user.id)
      .then(setAlarmPrefill)
      .catch((e) => {
        // FF1 — a failed read lands on the rule's own no-guess branch (the
        // card's 08:00 default), so there is nothing to tell the person
        // and nothing fabricated. Reported, never surfaced.
        captureError(e, { screen: 'today', op: 'resolvePrefillAlarmTime' });
      });
  }, [hasSeenRemindersAsk, session?.user?.id]);

  // WB1 job 1b — Today's one-time-ask slot, in priority order (reminders
  // has always had priority over the photo ask; that is unchanged). The
  // eligibility expressions are the ones each card already carried; what
  // is new is that the SLOT latches, so answering the reminders ask can no
  // longer promote the photo ask onto the same render. See the hook.
  //
  // BG1's rule applies: this is a hook, so it lives above the loading
  // early return, not beside the cards it feeds.
  const { activeAskId, dismissActive: dismissActiveAsk } = useOneTimeAskSlot([
    { id: ASK_REMINDERS, eligible: !hasSeenRemindersAsk },
    {
      id: ASK_PHOTO,
      eligible: !hasSeenPhotoAsk && !myAvatarUrl && hasAnyOwnCompletion && hasSeenRemindersAsk,
    },
  ]);

  // WB1 job 3 — the shared check-in flow. Also a hook, also above the
  // early return (BG1).
  const { launchCheckin, oneTapCircleId } = useCheckinLaunch({
    userId: session?.user?.id,
    hasSeenCheckinConsent,
    reflectionsOptOut,
    onError: setCheckinError,
  });

  // CR1 job 2 — the cap branch, now shared with the circles tab. A hook, so
  // it belongs ABOVE the early return with the others (BG1), not beside the
  // button it feeds further down.
  const { handleAddCircle } = useAddCircle({
    circleCount: circles.length,
    circleCap,
  });

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

  // ON1 — record Q2's obstacle, then refetch so the card gives way to the
  // Day-0 reflected sentence. ON2: it records on the PERSON now, so it
  // takes no circle — the same answer serves every circle they're in.
  const answerObstacle = async (key: string) => {
    const userId = session?.user?.id;
    if (!isObstacle(key) || !userId) return;
    try {
      await setKeepGoingObstacle(userId, key);
    } catch (e) {
      // FF2 — a swallowed failure here refetched straight back into the
      // same unanswered card, so a tap that never landed looked exactly
      // like a tap that did. Say so once, in ER1's register, and leave the
      // card where it is so the answer can be given again.
      captureError(e, { screen: 'today', op: 'setKeepGoingObstacle' });
      setError(STRINGS.saveFailedLine);
      return;
    }
    load();
  };

  // ON1 — the Day-0 intake's second half, on the first Today only. Q2 (the
  // obstacle) as one warm card while unanswered; once answered it gives way
  // to the reflected sentence that names the mechanic. Gated to a brand-new
  // person (no completions yet) who CREATED this circle — a solo creator is
  // still the creator, and an invited friend never is — asking joiners the
  // same question was DECLINED (Cat, 26 July; executed as ON2 job A), so
  // the invite loop stays clean and nothing here ever asks before joining.
  const onboardingIntakeBlock = (circle: MyCircle) => {
    if (hasAnyOwnCompletion || circle.createdBy !== session?.user?.id) return null;

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
          <TouchableOpacity key={k} style={styles.obstacleOption} onPress={() => answerObstacle(k)}>
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
  // PA2 — the road back from a finished rally (memo §8: "nulling it is
  // the road back"). One tap, no confirm: resuming costs nothing and
  // undoes nothing, so asking "are you sure?" would only add friction to
  // the direction the product wants to be easy.
  const handleResumeRally = async (circleId: string) => {
    if (resumingCircleId) return;
    setResumingCircleId(circleId);
    try {
      await resumeMyRally(circleId);
      await load();
    } catch {
      // ER1's warm line, never the raw message.
      setCheckinError(STRINGS.loadFailedLine('your rally'));
    } finally {
      setResumingCircleId(null);
    }
  };

  // WB1 job 3 — `goToCheckin` and `recordOneTapCheckin` moved WHOLE into
  // hooks/use-checkin-launch.ts, unchanged, because the circle screen now
  // offers a check-in and it has to be the same flow rather than a second
  // one that resembles it. Nothing about Today's behaviour moved with
  // them: same routes, same params, same audio unlock, same warm failure
  // line, and the same `oneTapCircleId` disabling the CTA mid-write.
  const goToCheckin = launchCheckin;

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
  // action hides it and stamps the flag for good; a failed stamp is
  // low-stakes (the card just might show once more).
  //
  // FF1's ASYMMETRY finding (FF2, 28 July): the seen-marker used to be
  // stamped BEFORE the prefs write was known to have landed, so a failed
  // write left reminders off forever with the only card that could turn
  // them on already retired. Nothing is stamped unless the write landed.
  //
  // AL1 job 4's prefill effect used to sit HERE, beside the card it feeds.
  // It is a hook, and this is below the loading early return — see BG1's
  // note at its new home above that return.
  //
  // WB1 job 1a — returns whether the writes LANDED. The card confirms only
  // on true, so the failure paths below (which already set the error line)
  // leave the ask in place rather than confirming something that did not
  // happen.
  const handleTurnOnReminders = async (alarm: RemindersAskAlarmChoice): Promise<boolean> => {
    if (!session?.user) return false;
    const userId = session.user.id;
    try {
      await updateNotificationPrefs(userId, { nudgeEnabled: true, digestEnabled: true });
    } catch (e) {
      captureError(e, { screen: 'today', op: 'updateNotificationPrefs' });
      setError(STRINGS.saveFailedLine);
      return false;
    }
    // AL1 job 4 — the personal practice time rides the same ask. Same
    // asymmetry rule as above: the seen-marker below is only stamped once
    // the writes that matter have landed, so a failure here leaves the
    // card in place rather than retiring the only surface that offers it.
    if (alarm.enabled) {
      try {
        await setAlarmReminder(userId, alarm);
        await syncDailyReminder({ enabled: true, alarmTime: alarm.time, requestPermission: true });
      } catch (e) {
        captureError(e, { screen: 'today', op: 'setAlarmReminder' });
        setError(STRINGS.saveFailedLine);
        return false;
      }
    }
    setHasSeenRemindersAsk(true);
    markRemindersAskSeen(userId).catch((e) =>
      captureError(e, { screen: 'today', op: 'markRemindersAskSeen' })
    );
    return true;
  };
  const handleMaybeLaterReminders = () => {
    if (!session?.user) return;
    setHasSeenRemindersAsk(true);
    dismissActiveAsk();
    // FF1 rule 3 — REPORTED, never swallowed. Silence for the USER is
    // right (the card is already gone from this session's slot, and an
    // error toast about bookkeeping would be worse than the bug), but
    // this is the durable half: if the write never lands, the ask comes
    // back on the next open having already been answered, and nothing
    // else in the app would ever notice. Same shape as
    // markPushPromptSeen in checkin-complete.
    markRemindersAskSeen(session.user.id).catch((e) =>
      captureError(e, { screen: 'today', op: 'markRemindersAskSeen' })
    );
  };
  const remindersAskCard =
    activeAskId === ASK_REMINDERS ? (
      <RemindersAskCard
        variant="compact"
        onTurnOn={handleTurnOnReminders}
        onMaybeLater={handleMaybeLaterReminders}
        alarmPrefillTime={alarmPrefill?.time}
        alarmPrefilled={alarmPrefill?.prefilled}
      />
    ) : null;

  // AV1 — the one-shot photo ask: photo-less account, never seen it,
  // first check-in celebrated. Any interaction stamps it forever (a
  // failed stamp is low-stakes — the card just might show once more).
  // Never stacked under the RM1 card: reminders keeps priority and the
  // photo ask simply waits for a later visit.
  //
  // WB1 job 1b — "never stacked under the RM1 card" is now a RULE rather
  // than a gate: the slot below holds whichever ask it first saw this
  // mount, so the photo ask cannot be promoted into the slot by the
  // reminders ask being answered. Its own eligibility is unchanged.
  const handlePhotoAskAdd = () => {
    if (!session?.user) return;
    setHasSeenPhotoAsk(true);
    // FF1 rule 3 — see handleMaybeLaterReminders above: silent for the
    // person, reported for us, because a lost write re-asks someone who
    // has already answered.
    markPhotoAskSeen(session.user.id).catch((e) =>
      captureError(e, { screen: 'today', op: 'markPhotoAskSeen' })
    );
    router.push('/settings');
  };
  const handlePhotoAskDismiss = () => {
    if (!session?.user) return;
    setHasSeenPhotoAsk(true);
    dismissActiveAsk();
    // FF1 rule 3 — same as the add path above.
    markPhotoAskSeen(session.user.id).catch((e) =>
      captureError(e, { screen: 'today', op: 'markPhotoAskSeen' })
    );
  };
  const photoAskCard =
    activeAskId === ASK_PHOTO && session?.user ? (
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
    // RS1/RS2 — every "N of M" headcount line counts only non-resting,
    // non-away members in M (they're still real members, just quietly
    // at the edge for now); the circle screen owns the actual visual
    // fade/sleeping badge, this screen's own member row is untouched
    // per RS1's scope.
    // PA2 — finished members leave the active roster, same as resting
    // and away members (memo §8). They remain members and remain visible.
    const activeMembers = attachRestingStatus(members, presence, today).filter(
      (m) => !m.isResting && !m.awaySince && !m.finishedAt
    );
    const activeMemberCount = activeMembers.length;
    // AU1 job 2 — the NUMERATOR gets the same roster rule the
    // denominator has had since RS1. `inTodayUserIds.size` counted every
    // completion row for today, an away or finished member's included,
    // so the pair could read "3 of 2" and the all-in equality could be
    // satisfied by a different set of people than the active roster.
    // The avatar strip below still reads inTodayUserIds directly — an
    // away member who checked in absolutely keeps their badge; it is
    // only the sentence that counts the roster.
    const inCount = activeMembers.filter((m) => inTodayUserIds.has(m.userId)).length;
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

    // PA2 — the single-circle version of the finished state. Same rule:
    // a finished member is never asked to check in, and always has the
    // road back one tap away (memo §8 — "nulling it is the road back").
    if (circle.myFinishedAt) {
      return (
        <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
          <AppHeader hideHouse style={styles.topbar} />
          {refreshFailedBanner}
          <Text style={styles.greeting}>{greeting(myName)}</Text>
          <GlowBadge
            glow={glow}
            coveredByName={iWasCoveredToday ? memberFullName(members, iWasCoveredToday.coveredBy) : null}
            flickerOnce={glowOneShot}
          />
          {birthdayBanner}
          {spotAlways}
          <View style={styles.card}>
            <Text style={styles.completedCardTitle}>{STRINGS.journeyFinishedCardTitle}</Text>
            <Text style={styles.completedCardBody}>
              {STRINGS.journeyFinishedCardBody(countRallyDays(presence, session?.user?.id ?? ''))}
            </Text>
            <TouchableOpacity onPress={() => handleResumeRally(circle.id)} disabled={resumingCircleId === circle.id}>
              <Text style={styles.resumeRallyLink}>
                {resumingCircleId === circle.id ? '…' : STRINGS.journeyFinishedResumeCta}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push({ pathname: '/circle', params: { circleId: circle.id } })}
          >
            <Text style={styles.cardLink}>view circle →</Text>
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
          {/* AU1 job 4 (Cat, 3 Aug) — no dayNumber: the circle's age is
              off Today entirely and nothing replaces it here. It lives
              on the circle screen, relabelled "circle day N". */}
          <SignalMeter
            state={signal.state}
            dailyRates={signal.dailyRates}
            rallyCount={countRallyDays(presence, session?.user?.id ?? '')}
            isSolo={isSolo}
          />
          <Text style={styles.cardLink}>
            {isSolo
              ? 'view your practice →'
              : `${headcountLine(inCount, activeMemberCount)} · view circle →`}
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
        // RS1/RS2 — see the single-circle branch above for the full note.
        // PA2 — see the single-circle branch above: finished members
        // leave the active roster but never the huddle.
        // AU1 job 2 — numerator restricted to the active roster, same as
        // the single-circle branch above.
        const activeMembers = attachRestingStatus(members, presence, today).filter(
          (m) => !m.isResting && !m.awaySince && !m.finishedAt
        );
        const activeMemberCount = activeMembers.length;
        const inCount = activeMembers.filter((m) => inTodayUserIds.has(m.userId)).length;
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

        // PA2 — a member who FINISHED their rally here. Without this the
        // whole feature would be cosmetic: the huddle would call them
        // finished while Today went on asking them to check in every
        // morning. The circle keeps its place in the stack (they are
        // still a member, and it is still theirs to look at), it simply
        // stops asking — and carries the road back.
        if (circle.myFinishedAt) {
          return (
            <View key={circle.id} style={styles.stackCard}>
              <Text style={styles.stackCardName}>{circle.name}</Text>
              <Text style={styles.completedCardTitle}>{STRINGS.journeyFinishedCardTitle}</Text>
              <Text style={styles.completedCardBody}>
                {STRINGS.journeyFinishedCardBody(countRallyDays(presence, session?.user?.id ?? ''))}
              </Text>
              <TouchableOpacity onPress={() => handleResumeRally(circle.id)} disabled={resumingCircleId === circle.id}>
                <Text style={styles.resumeRallyLink}>
                  {resumingCircleId === circle.id ? '…' : STRINGS.journeyFinishedResumeCta}
                </Text>
              </TouchableOpacity>
            </View>
          );
        }

        return (
          <View key={circle.id} style={styles.stackCard}>
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/circle', params: { circleId: circle.id } })}
            >
              <Text style={styles.stackCardName}>{circle.name}</Text>
              {/* AU1 job 4 — no dayNumber here either; see the
                  single-circle branch above. */}
              <SignalMeter
                state={signal.state}
                dailyRates={signal.dailyRates}
                rallyCount={countRallyDays(presence, session?.user?.id ?? '')}
                isSolo={isSolo}
              />
              <Text style={styles.cardLink}>
                {isSolo
                  ? 'view your practice →'
                  : `${headcountLine(inCount, activeMemberCount)} · view circle →`}
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
      {!reflectionsOptOut && !hasWrittenReflectionToday && reflectionQuestion && circles.length > 0 && (
        <TouchableOpacity
          style={styles.reflectionTeaser}
          onPress={() => {
            // HY1 job 1 (R3) — THE PRIMARY-CIRCLE LAW (CLAUDE.md: "No
            // code may assume a single or primary circle"). This teaser
            // used to open `circles[0]`'s check-in, and a check-in is
            // not a read: finishing it WRITES a completion. So a guess
            // here could record someone's day against a circle they
            // never picked — the invite-screen class the law was written
            // after, with a durable side effect attached.
            //
            // The reflection itself is per-person-per-day and carries no
            // circleId (lib/reflections.ts), which is precisely why this
            // screen cannot infer one: nothing about the question names
            // a practice. So it takes the law's own answer — one circle
            // is unambiguous, more than one gets ASKED — and hands the
            // ask to the circle tab's existing picker rather than
            // inventing a second one. Clean path, no params: a stale
            // `circleId` is what OD1 job 6 cleared for the same reason.
            const selection = selectFromMyCircles(circles);
            if (selection.kind === 'picker' || !selection.circle) {
              router.push('/circle');
              return;
            }
            const only = selection.circle;
            const onlyData = circleData[only.id] ?? { members: [], presence: [], lastCelebratedDay: 0 };
            const onlySignal = computeSignal({
              presence: onlyData.presence,
              memberCount: onlyData.members.length,
              today,
              circleStartDate: only.startDate,
            });
            goToCheckin(only, false, onlySignal.dayNumber);
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
    color: colors.mutedStrong,
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
    color: colors.mutedStrong,
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
    color: colors.greenDisplay,
  },
  subtitle: {
    fontSize: 13,
    color: colors.mutedStrong,
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
    color: colors.mutedStrong,
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
    color: colors.mutedStrong,
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
    color: colors.mutedStrong,
    lineHeight: 18,
  },
  // PA2 — the road back. greenText, not colors.green: green is a FILL
  // colour and fails contrast as text (OD1 job 10). Green because coming
  // back is progress, and this is deliberately the warmest thing on a
  // finished card.
  resumeRallyLink: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.greenText,
    marginTop: 10,
    minHeight: 44,
    paddingTop: 12,
  },
  cardLink: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.mutedStrong,
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
    color: colors.mutedStrong,
    marginTop: 5,
  },
  // GS1 — the ambient flame under a glowing member's name. Quiet by
  // design; simply absent below 7 days.
  glowFlameLine: {
    fontSize: 9,
    color: colors.mutedStrong,
    marginTop: 1,
  },
  // TN1 — the whisper's styles retired with it; the notification spot
  // owns its own look (components/TodayNotificationSpot.tsx).
  // WL2 — the wall teaser: one muted line under the members, the same
  // quiet-navigation register as "This week" (ink/muted, never green).
  wallTeaserLine: {
    fontSize: 11.5,
    color: colors.mutedStrong,
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
